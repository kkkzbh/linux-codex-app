#include <QCoreApplication>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QDBusUnixFileDescriptor>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLibrary>
#include <QTextStream>
#include <QVariant>

#include <cstdint>
#include <chrono>
#include <poll.h>

struct ei;
struct ei_event;
struct ei_seat;
struct ei_device;

struct libei_api
{
    libei_api()
        : library{ nullptr }
    {
    }

    auto load() -> bool
    {
        library.setFileName(QStringLiteral("libei.so.1"));
        if(not library.load()) {
            return false;
        }
        return resolve(ei_new_sender, "ei_new_sender")
            and resolve(ei_configure_name, "ei_configure_name")
            and resolve(ei_setup_backend_fd, "ei_setup_backend_fd")
            and resolve(ei_dispatch, "ei_dispatch")
            and resolve(ei_get_event, "ei_get_event")
            and resolve(ei_event_get_type, "ei_event_get_type")
            and resolve(ei_event_unref, "ei_event_unref")
            and resolve(ei_unref, "ei_unref")
            and resolve(ei_get_fd, "ei_get_fd")
            and resolve(ei_event_get_seat, "ei_event_get_seat")
            and resolve(ei_seat_has_capability, "ei_seat_has_capability")
            and resolve(ei_seat_bind_capabilities, "ei_seat_bind_capabilities")
            and resolve(ei_event_get_device, "ei_event_get_device")
            and resolve(ei_device_has_capability, "ei_device_has_capability")
            and resolve(ei_device_ref, "ei_device_ref")
            and resolve(ei_device_unref, "ei_device_unref")
            and resolve(ei_device_pointer_motion_absolute, "ei_device_pointer_motion_absolute")
            and resolve(ei_device_button_button, "ei_device_button_button")
            and resolve(ei_device_scroll_delta, "ei_device_scroll_delta")
            and resolve(ei_device_scroll_stop, "ei_device_scroll_stop")
            and resolve(ei_device_keyboard_key, "ei_device_keyboard_key")
            and resolve(ei_device_frame, "ei_device_frame")
            and resolve(ei_device_start_emulating, "ei_device_start_emulating")
            and resolve(ei_device_stop_emulating, "ei_device_stop_emulating");
    }

    template<typename function_type>
    auto resolve(function_type& target, char const* name) -> bool
    {
        target = reinterpret_cast<function_type>(library.resolve(name));
        return target != nullptr;
    }

    QLibrary library;
    ei* (*ei_new_sender)(void*) = nullptr;
    void (*ei_configure_name)(ei*, char const*) = nullptr;
    int (*ei_setup_backend_fd)(ei*, int) = nullptr;
    int (*ei_dispatch)(ei*) = nullptr;
    ei_event* (*ei_get_event)(ei*) = nullptr;
    int (*ei_event_get_type)(ei_event*) = nullptr;
    ei_event* (*ei_event_unref)(ei_event*) = nullptr;
    ei* (*ei_unref)(ei*) = nullptr;
    int (*ei_get_fd)(ei*) = nullptr;
    ei_seat* (*ei_event_get_seat)(ei_event*) = nullptr;
    int (*ei_seat_has_capability)(ei_seat*, uint32_t) = nullptr;
    void (*ei_seat_bind_capabilities)(ei_seat*, ...) = nullptr;
    ei_device* (*ei_event_get_device)(ei_event*) = nullptr;
    int (*ei_device_has_capability)(ei_device*, uint32_t) = nullptr;
    ei_device* (*ei_device_ref)(ei_device*) = nullptr;
    ei_device* (*ei_device_unref)(ei_device*) = nullptr;
    void (*ei_device_pointer_motion_absolute)(ei_device*, double, double) = nullptr;
    void (*ei_device_button_button)(ei_device*, uint32_t, int) = nullptr;
    void (*ei_device_scroll_delta)(ei_device*, double, double) = nullptr;
    void (*ei_device_scroll_stop)(ei_device*, int, int) = nullptr;
    void (*ei_device_keyboard_key)(ei_device*, uint32_t, int) = nullptr;
    void (*ei_device_frame)(ei_device*, uint64_t) = nullptr;
    void (*ei_device_start_emulating)(ei_device*, uint32_t) = nullptr;
    void (*ei_device_stop_emulating)(ei_device*) = nullptr;
};

struct eis_session
{
    auto start() -> QString
    {
        if(not api.load()) {
            return QStringLiteral("could not load the complete libei runtime API");
        }
        auto interface = QDBusInterface{
            QStringLiteral("org.kde.KWin"),
            QStringLiteral("/org/kde/KWin/EIS/RemoteDesktop"),
            QStringLiteral("org.kde.KWin.EIS.RemoteDesktop"),
            QDBusConnection::sessionBus(),
        };
        if(not interface.isValid()) {
            return QStringLiteral("KWin EIS D-Bus interface is unavailable");
        }
        auto constexpr capabilities = qint32{ 1 | 2 | 4 | 16 | 32 };
        auto reply = interface.call(QStringLiteral("connectToEIS"), capabilities);
        if(reply.type() == QDBusMessage::ErrorMessage or reply.arguments().size() < 2) {
            return QStringLiteral("KWin connectToEIS failed: %1").arg(reply.errorMessage());
        }
        auto descriptor = qvariant_cast<QDBusUnixFileDescriptor>(reply.arguments()[0]);
        if(not descriptor.isValid()) {
            return QStringLiteral("KWin connectToEIS returned an invalid descriptor");
        }
        context = api.ei_new_sender(nullptr);
        if(context == nullptr) {
            return QStringLiteral("libei could not create a sender");
        }
        api.ei_configure_name(context, "codex-computer-use-isolated");
        if(auto result = api.ei_setup_backend_fd(context, descriptor.takeFileDescriptor()); result != 0) {
            return QStringLiteral("libei could not attach the KWin descriptor: %1").arg(result);
        }
        return negotiate();
    }

    auto negotiate() -> QString
    {
        auto timer = QElapsedTimer{};
        timer.start();
        while(pointer == nullptr or keyboard == nullptr) {
            if(timer.elapsed() > 10000) {
                return QStringLiteral("timed out negotiating KWin EIS devices");
            }
            auto descriptor = pollfd{ .fd = api.ei_get_fd(context), .events = POLLIN, .revents = 0 };
            if(::poll(&descriptor, 1, 250) > 0 and api.ei_dispatch(context) < 0) {
                return QStringLiteral("KWin EIS disconnected during negotiation");
            }
            while(auto* event = api.ei_get_event(context)) {
                auto type = api.ei_event_get_type(event);
                if(type == 2) {
                    api.ei_event_unref(event);
                    return QStringLiteral("KWin EIS disconnected during negotiation");
                }
                if(type == 3) {
                    auto* seat = api.ei_event_get_seat(event);
                    api.ei_seat_bind_capabilities(seat, 1U, 2U, 4U, 16U, 32U, 0U);
                }
                if(type == 5) {
                    auto* device = api.ei_event_get_device(event);
                    if(pointer == nullptr and api.ei_device_has_capability(device, 2U)) {
                        pointer = api.ei_device_ref(device);
                    }
                    if(keyboard == nullptr and api.ei_device_has_capability(device, 4U)) {
                        keyboard = api.ei_device_ref(device);
                    }
                }
                api.ei_event_unref(event);
            }
        }
        api.ei_device_start_emulating(pointer, 0);
        if(keyboard != pointer) {
            api.ei_device_start_emulating(keyboard, 0);
        }
        return {};
    }

    auto frame(ei_device* device) -> bool
    {
        auto now = std::chrono::steady_clock::now().time_since_epoch();
        auto microseconds = std::chrono::duration_cast<std::chrono::microseconds>(now).count();
        api.ei_device_frame(device, static_cast<uint64_t>(microseconds));
        return api.ei_dispatch(context) >= 0;
    }

    auto handle(QJsonObject const& request) -> QJsonObject
    {
        auto operation = request.value(QStringLiteral("op")).toString();
        if(operation == QStringLiteral("move")) {
            api.ei_device_pointer_motion_absolute(pointer, request.value(QStringLiteral("x")).toDouble(), request.value(QStringLiteral("y")).toDouble());
            return result(frame(pointer));
        }
        if(operation == QStringLiteral("button")) {
            api.ei_device_button_button(pointer, static_cast<uint32_t>(request.value(QStringLiteral("code")).toInt()), request.value(QStringLiteral("pressed")).toBool() ? 1 : 0);
            return result(frame(pointer));
        }
        if(operation == QStringLiteral("scroll")) {
            api.ei_device_scroll_delta(pointer, request.value(QStringLiteral("dx")).toDouble(), request.value(QStringLiteral("dy")).toDouble());
            if(request.value(QStringLiteral("stop")).toBool()) {
                api.ei_device_scroll_stop(pointer, 1, 1);
            }
            return result(frame(pointer));
        }
        if(operation == QStringLiteral("key")) {
            api.ei_device_keyboard_key(keyboard, static_cast<uint32_t>(request.value(QStringLiteral("code")).toInt()), request.value(QStringLiteral("pressed")).toBool() ? 1 : 0);
            return result(frame(keyboard));
        }
        return QJsonObject{ { QStringLiteral("ok"), false }, { QStringLiteral("error"), QStringLiteral("unknown EIS operation") } };
    }

    auto result(bool ok) -> QJsonObject
    {
        return ok ? QJsonObject{ { QStringLiteral("ok"), true } }
                  : QJsonObject{ { QStringLiteral("ok"), false }, { QStringLiteral("error"), QStringLiteral("KWin EIS rejected the input event") } };
    }

    auto close() -> void
    {
        auto* pointer_value = pointer;
        auto* keyboard_value = keyboard;
        pointer = nullptr;
        keyboard = nullptr;
        if(pointer_value != nullptr) {
            api.ei_device_stop_emulating(pointer_value);
            api.ei_device_unref(pointer_value);
        }
        if(keyboard_value != nullptr and keyboard_value != pointer_value) {
            api.ei_device_stop_emulating(keyboard_value);
            api.ei_device_unref(keyboard_value);
        }
        if(context != nullptr) {
            api.ei_unref(context);
            context = nullptr;
        }
    }

    ~eis_session()
    {
        close();
    }

    libei_api api;
    ei* context = nullptr;
    ei_device* pointer = nullptr;
    ei_device* keyboard = nullptr;
};

auto main(int argc, char* argv[]) -> int
{
    auto application = QCoreApplication{ argc, argv };
    auto session = eis_session{};
    if(auto error = session.start(); not error.isEmpty()) {
        QTextStream{ stderr } << error << Qt::endl;
        return 1;
    }
    auto input = QTextStream{ stdin };
    auto output = QTextStream{ stdout };
    output << QJsonDocument{ QJsonObject{ { QStringLiteral("event"), QStringLiteral("ready") } } }.toJson(QJsonDocument::Compact) << Qt::endl;
    output.flush();
    while(not input.atEnd()) {
        auto line = input.readLine();
        if(line.isEmpty()) {
            continue;
        }
        auto document = QJsonDocument::fromJson(line.toUtf8());
        auto request = document.object();
        auto response = session.handle(request);
        response.insert(QStringLiteral("id"), request.value(QStringLiteral("id")));
        output << QJsonDocument{ response }.toJson(QJsonDocument::Compact) << Qt::endl;
        output.flush();
    }
    return 0;
}
