#include <QBuffer>
#include <QByteArray>
#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusError>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QDBusReply>
#include <QDBusUnixFileDescriptor>
#include <QFile>
#include <QImage>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStringList>
#include <QVariantMap>

#include <chrono>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <limits>
#include <optional>
#include <sys/mman.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

struct capture_request
{
    enum class target
    {
        workspace,
        area,
        window,
    };

    target capture_target = target::workspace;
    QString window_id;
    int x = 0;
    int y = 0;
    uint width = 0;
    uint height = 0;
};

struct owned_file_descriptor
{
    owned_file_descriptor() = default;

    explicit owned_file_descriptor(int value) : value(value)
    {
    }

    owned_file_descriptor(owned_file_descriptor const&) = delete;
    auto operator=(owned_file_descriptor const&) -> owned_file_descriptor& = delete;

    owned_file_descriptor(owned_file_descriptor&& other) noexcept : value(other.value)
    {
        other.value = -1;
    }

    auto operator=(owned_file_descriptor&& other) noexcept -> owned_file_descriptor&
    {
        if(this != &other) {
            close_current();
            value = other.value;
            other.value = -1;
        }
        return *this;
    }

    ~owned_file_descriptor()
    {
        close_current();
    }

    auto get() const -> int
    {
        return value;
    }

private:
    auto close_current() -> void
    {
        if(value >= 0) {
            close(value);
            value = -1;
        }
    }

    int value = -1;
};

struct image_layout
{
    uint width;
    uint height;
    uint stride;
    QImage::Format format;
    qsizetype byte_count;
};

auto fail(QString const& message) -> int
{
    auto encoded = message.toUtf8();
    std::fprintf(stderr, "%s\n", encoded.constData());
    return 1;
}

auto parse_uint(QString const& text, char const* name, uint& value) -> bool
{
    auto ok = false;
    auto parsed = text.toUInt(&ok);
    if(not ok or parsed == 0) {
        std::fprintf(stderr, "invalid %s: %s\n", name, text.toUtf8().constData());
        return false;
    }
    value = parsed;
    return true;
}

auto parse_int(QString const& text, char const* name, int& value) -> bool
{
    auto ok = false;
    auto parsed = text.toInt(&ok);
    if(not ok) {
        std::fprintf(stderr, "invalid %s: %s\n", name, text.toUtf8().constData());
        return false;
    }
    value = parsed;
    return true;
}

auto parse_args(QStringList const& args, capture_request& request) -> bool
{
    if(args.size() == 2 and args[1] == QStringLiteral("--workspace")) {
        request.capture_target = capture_request::target::workspace;
        return true;
    }

    if(args.size() == 6 and args[1] == QStringLiteral("--area")) {
        request.capture_target = capture_request::target::area;
        return parse_int(args[2], "x", request.x) and parse_int(args[3], "y", request.y) and parse_uint(args[4], "width", request.width) and parse_uint(args[5], "height", request.height);
    }

    if(args.size() == 3 and args[1] == QStringLiteral("--window") and not args[2].isEmpty()) {
        request.capture_target = capture_request::target::window;
        request.window_id = args[2];
        return true;
    }

    std::fprintf(stderr, "usage: %s --workspace | --area <x> <y> <width> <height> | --window <internal-id>\n", args[0].toUtf8().constData());
    return false;
}

auto make_screenshot_buffer() -> owned_file_descriptor
{
    return owned_file_descriptor{ memfd_create("codex-computer-use-screenshot", MFD_CLOEXEC) };
}

auto screenshot_options() -> QVariantMap
{
    return {
        { QStringLiteral("include-cursor"), true },
        { QStringLiteral("native-resolution"), true },
    };
}

auto call_screenshot(capture_request const& request, int write_fd, QVariantMap& metadata) -> bool
{
    auto iface = QDBusInterface{
        QStringLiteral("org.kde.KWin.ScreenShot2"),
        QStringLiteral("/org/kde/KWin/ScreenShot2"),
        QStringLiteral("org.kde.KWin.ScreenShot2"),
        QDBusConnection::sessionBus(),
    };
    if(not iface.isValid()) {
        std::fprintf(stderr, "KWin ScreenShot2 interface unavailable: %s\n", iface.lastError().message().toUtf8().constData());
        return false;
    }

    auto descriptor = QDBusUnixFileDescriptor{ write_fd };
    auto message = QDBusMessage{};
    if(request.capture_target == capture_request::target::workspace) {
        message = iface.call(QStringLiteral("CaptureWorkspace"), screenshot_options(), QVariant::fromValue(descriptor));
    } else if(request.capture_target == capture_request::target::area) {
        message = iface.call(QStringLiteral("CaptureArea"), request.x, request.y, request.width, request.height, screenshot_options(), QVariant::fromValue(descriptor));
    } else {
        message = iface.call(QStringLiteral("CaptureWindow"), request.window_id, screenshot_options(), QVariant::fromValue(descriptor));
    }
    if(message.type() == QDBusMessage::ErrorMessage) {
        std::fprintf(stderr, "KWin ScreenShot2 call failed: %s: %s\n", message.errorName().toUtf8().constData(), message.errorMessage().toUtf8().constData());
        return false;
    }

    auto reply = QDBusReply<QVariantMap>{ message };
    if(not reply.isValid()) {
        std::fprintf(stderr, "KWin ScreenShot2 returned invalid metadata: %s: %s\n", reply.error().name().toUtf8().constData(), reply.error().message().toUtf8().constData());
        return false;
    }

    metadata = reply.value();
    return true;
}

auto metadata_uint(QVariantMap const& metadata, char const* key) -> std::optional<uint>
{
    auto variant = metadata.value(QString::fromLatin1(key));
    auto ok = false;
    auto parsed = variant.toUInt(&ok);
    if(not ok or parsed == 0) {
        std::fprintf(stderr, "KWin ScreenShot2 metadata missing %s\n", key);
        return std::nullopt;
    }
    return parsed;
}

auto parse_image_layout(QVariantMap const& metadata) -> std::optional<image_layout>
{
    if(metadata.value(QStringLiteral("type")).toString() != QStringLiteral("raw")) {
        std::fprintf(stderr, "unsupported KWin ScreenShot2 image type: %s\n", metadata.value(QStringLiteral("type")).toString().toUtf8().constData());
        return std::nullopt;
    }

    auto width = metadata_uint(metadata, "width");
    auto height = metadata_uint(metadata, "height");
    auto stride = metadata_uint(metadata, "stride");
    auto format = metadata_uint(metadata, "format");
    if(not width or not height or not stride or not format) {
        return std::nullopt;
    }

    auto image_format = static_cast<QImage::Format>(*format);
    auto row_probe = QImage{ static_cast<int>(*width), 1, image_format };
    if(row_probe.isNull()) {
        std::fprintf(stderr, "KWin ScreenShot2 returned unsupported QImage format: %u\n", *format);
        return std::nullopt;
    }

    auto last_row_size = row_probe.sizeInBytes();
    if(last_row_size > qsizetype{ *stride }) {
        std::fprintf(stderr, "KWin ScreenShot2 metadata stride %u is smaller than row payload %lld\n", *stride, static_cast<long long>(last_row_size));
        return std::nullopt;
    }

    auto byte_count = quint64{ *stride } * quint64{ *height - 1 } + static_cast<quint64>(last_row_size);
    if(byte_count > static_cast<quint64>(std::numeric_limits<qsizetype>::max())) {
        std::fprintf(stderr, "KWin ScreenShot2 image is too large\n");
        return std::nullopt;
    }

    return image_layout{
        .width = *width,
        .height = *height,
        .stride = *stride,
        .format = image_format,
        .byte_count = static_cast<qsizetype>(byte_count),
    };
}

auto read_screenshot_buffer(int file_descriptor, qsizetype expected_size) -> QByteArray
{
    using namespace std::chrono_literals;
    auto deadline = std::chrono::steady_clock::now() + 30s;
    for(;;) {
        struct stat status {};
        if(fstat(file_descriptor, &status) != 0) {
            std::fprintf(stderr, "failed to inspect screenshot buffer: %s\n", std::strerror(errno));
            return {};
        }
        if(status.st_size == expected_size) {
            break;
        }
        if(status.st_size > expected_size) {
            std::fprintf(stderr, "KWin ScreenShot2 wrote %lld bytes, expected %lld\n", static_cast<long long>(status.st_size), static_cast<long long>(expected_size));
            return {};
        }
        if(std::chrono::steady_clock::now() >= deadline) {
            std::fprintf(stderr, "KWin ScreenShot2 wrote %lld bytes before the 30 second deadline, expected %lld\n", static_cast<long long>(status.st_size), static_cast<long long>(expected_size));
            return {};
        }
        std::this_thread::sleep_for(2ms);
    }

    auto result = QByteArray{ expected_size, Qt::Uninitialized };
    auto offset = qsizetype{};
    while(offset < expected_size) {
        auto count = pread(file_descriptor, result.data() + offset, static_cast<size_t>(expected_size - offset), offset);
        if(count > 0) {
            offset += count;
            continue;
        }
        if(count < 0 and errno == EINTR) {
            continue;
        }
        std::fprintf(stderr, "failed to read screenshot buffer: %s\n", count == 0 ? "unexpected end of file" : std::strerror(errno));
        return {};
    }
    return result;
}

auto png_from_raw(QByteArray const& raw, image_layout const& layout, QByteArray& png) -> bool
{
    if(raw.size() != layout.byte_count) {
        std::fprintf(stderr, "KWin ScreenShot2 buffer returned %lld bytes, expected %lld\n", static_cast<long long>(raw.size()), static_cast<long long>(layout.byte_count));
        return false;
    }

    auto image = QImage{
        reinterpret_cast<uchar const*>(raw.constData()),
        static_cast<int>(layout.width),
        static_cast<int>(layout.height),
        static_cast<qsizetype>(layout.stride),
        layout.format,
    };
    if(image.isNull()) {
        std::fprintf(stderr, "KWin ScreenShot2 returned unsupported QImage format: %u\n", static_cast<uint>(layout.format));
        return false;
    }

    auto buffer = QBuffer{ &png };
    if(not buffer.open(QIODevice::WriteOnly) or not image.save(&buffer, "PNG")) {
        std::fprintf(stderr, "failed to encode KWin ScreenShot2 image as PNG\n");
        return false;
    }
    return true;
}

auto write_json(QByteArray const& png, QVariantMap const& metadata, bool cropped) -> bool
{
    auto output = QJsonObject{
        { QStringLiteral("mime_type"), QStringLiteral("image/png") },
        { QStringLiteral("width"), static_cast<int>(metadata.value(QStringLiteral("width")).toUInt()) },
        { QStringLiteral("height"), static_cast<int>(metadata.value(QStringLiteral("height")).toUInt()) },
        { QStringLiteral("cropped"), cropped },
        { QStringLiteral("scale"), metadata.value(QStringLiteral("scale")).toDouble() },
        { QStringLiteral("format"), static_cast<int>(metadata.value(QStringLiteral("format")).toUInt()) },
        { QStringLiteral("data_base64"), QString::fromLatin1(png.toBase64()) },
    };
    auto stdout_file = QFile{};
    if(not stdout_file.open(stdout, QIODevice::WriteOnly)) {
        std::fprintf(stderr, "failed to open stdout\n");
        return false;
    }
    stdout_file.write(QJsonDocument(output).toJson(QJsonDocument::Compact));
    stdout_file.write("\n");
    return true;
}

auto main(int argc, char* argv[]) -> int
{
    auto app = QCoreApplication{ argc, argv };
    auto request = capture_request{};
    if(not parse_args(app.arguments(), request)) {
        return 2;
    }

    auto screenshot_buffer = make_screenshot_buffer();
    if(screenshot_buffer.get() < 0) {
        return fail(QStringLiteral("failed to create screenshot memory buffer"));
    }

    auto metadata = QVariantMap{};
    if(not call_screenshot(request, screenshot_buffer.get(), metadata)) {
        return 1;
    }

    auto layout = parse_image_layout(metadata);
    if(not layout) {
        return 1;
    }
    auto raw = read_screenshot_buffer(screenshot_buffer.get(), layout->byte_count);
    if(raw.isEmpty()) {
        return fail(QStringLiteral("KWin ScreenShot2 memory buffer returned no image data"));
    }

    auto png = QByteArray{};
    if(not png_from_raw(raw, *layout, png)) {
        return 1;
    }

    return write_json(png, metadata, request.capture_target != capture_request::target::workspace) ? 0 : 1;
}
