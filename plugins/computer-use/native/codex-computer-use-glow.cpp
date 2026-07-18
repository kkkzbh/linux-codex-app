#include <X11/Xcursor/Xcursor.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <limits>
#include <numbers>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include <unistd.h>

namespace fs = std::filesystem;

namespace {

auto constexpr animation_frames = 32;
auto constexpr animation_frame_delay_ms = 50;
auto constexpr cyan_red = 77.0 / 255.0;
auto constexpr cyan_green = 233.0 / 255.0;
auto constexpr cyan_blue = 1.0;

struct rgba
{
    double red = 0.0;
    double green = 0.0;
    double blue = 0.0;
    double alpha = 0.0;
};

auto over(rgba destination, rgba source) -> rgba
{
    auto inverse_source_alpha = 1.0 - source.alpha;
    return {
        source.red + destination.red * inverse_source_alpha,
        source.green + destination.green * inverse_source_alpha,
        source.blue + destination.blue * inverse_source_alpha,
        source.alpha + destination.alpha * inverse_source_alpha,
    };
}

auto solid_layer(double red, double green, double blue, double alpha) -> rgba
{
    auto bounded_alpha = std::clamp(alpha, 0.0, 1.0);
    return {
        red * bounded_alpha,
        green * bounded_alpha,
        blue * bounded_alpha,
        bounded_alpha,
    };
}

auto unpack_pixel(XcursorPixel pixel) -> rgba
{
    return {
        static_cast<double>((pixel >> 16U) & 0xffU) / 255.0,
        static_cast<double>((pixel >> 8U) & 0xffU) / 255.0,
        static_cast<double>(pixel & 0xffU) / 255.0,
        static_cast<double>((pixel >> 24U) & 0xffU) / 255.0,
    };
}

auto byte_channel(double value) -> std::uint32_t
{
    return static_cast<std::uint32_t>(std::lround(std::clamp(value, 0.0, 1.0) * 255.0));
}

auto pack_pixel(rgba color) -> XcursorPixel
{
    return (byte_channel(color.alpha) << 24U) | (byte_channel(color.red) << 16U)
        | (byte_channel(color.green) << 8U) | byte_channel(color.blue);
}

auto cursor_search_roots() -> std::vector<fs::path>
{
    auto roots = std::vector<fs::path>{};
    auto append_path_list = [&roots](char const* value) {
        if(value == nullptr) {
            return;
        }
        auto list = std::string_view{ value };
        auto offset = std::size_t{};
        while(offset <= list.size()) {
            auto separator = list.find(':', offset);
            auto entry = list.substr(offset, separator == std::string_view::npos ? list.size() - offset : separator - offset);
            if(not entry.empty()) {
                roots.emplace_back(entry);
            }
            if(separator == std::string_view::npos) {
                break;
            }
            offset = separator + 1;
        }
    };

    append_path_list(std::getenv("XCURSOR_PATH"));
    auto home = std::getenv("HOME");
    if(home != nullptr) {
        roots.emplace_back(home);
        roots.back() /= ".icons";
    }
    auto data_home = std::getenv("XDG_DATA_HOME");
    if(data_home != nullptr and *data_home != '\0') {
        roots.emplace_back(data_home);
        roots.back() /= "icons";
    } else if(home != nullptr) {
        roots.emplace_back(home);
        roots.back() /= ".local/share/icons";
    }
    auto data_dirs = std::getenv("XDG_DATA_DIRS");
    if(data_dirs != nullptr and *data_dirs != '\0') {
        auto start = std::size_t{};
        auto dirs = std::string_view{ data_dirs };
        while(start <= dirs.size()) {
            auto separator = dirs.find(':', start);
            auto entry = dirs.substr(start, separator == std::string_view::npos ? dirs.size() - start : separator - start);
            if(not entry.empty()) {
                roots.emplace_back(entry);
                roots.back() /= "icons";
            }
            if(separator == std::string_view::npos) {
                break;
            }
            start = separator + 1;
        }
    } else {
        roots.emplace_back("/usr/local/share/icons");
        roots.emplace_back("/usr/share/icons");
    }
    roots.emplace_back("/usr/share/pixmaps");
    return roots;
}

auto find_cursor_directory(std::string const& theme) -> fs::path
{
    if(theme.empty() or theme.find('/') != std::string::npos) {
        throw std::runtime_error("source cursor theme must be a theme name");
    }
    for(auto const& root : cursor_search_roots()) {
        auto cursors = root / theme / "cursors";
        if(fs::is_directory(cursors)) {
            return cursors;
        }
    }
    throw std::runtime_error("source cursor theme was not found: " + theme);
}

auto source_frame_at(XcursorImages const& images, std::uint64_t elapsed_ms) -> XcursorImage const&
{
    auto cycle_ms = std::uint64_t{};
    for(auto index = 0; index < images.nimage; ++index) {
        cycle_ms += std::max<std::uint64_t>(1, images.images[index]->delay);
    }
    auto position = elapsed_ms % cycle_ms;
    for(auto index = 0; index < images.nimage; ++index) {
        auto delay = std::max<std::uint64_t>(1, images.images[index]->delay);
        if(position < delay) {
            return *images.images[index];
        }
        position -= delay;
    }
    return *images.images[images.nimage - 1];
}

auto alpha_at(XcursorImage const& image, int x, int y) -> int
{
    auto width = static_cast<int>(image.width);
    auto height = static_cast<int>(image.height);
    if(x < 0 or y < 0 or x >= width or y >= height) {
        return 0;
    }
    auto pixel = image.pixels[static_cast<std::size_t>(y) * image.width + static_cast<std::size_t>(x)];
    return static_cast<int>((pixel >> 24U) & 0xffU);
}

auto nearest_visible_distance(XcursorImage const& source, int source_x, int source_y, int search_radius) -> double
{
    auto minimum_squared = std::numeric_limits<int>::max();
    auto left = std::max(0, source_x - search_radius);
    auto right = std::min(static_cast<int>(source.width) - 1, source_x + search_radius);
    auto top = std::max(0, source_y - search_radius);
    auto bottom = std::min(static_cast<int>(source.height) - 1, source_y + search_radius);
    for(auto y = top; y <= bottom; ++y) {
        for(auto x = left; x <= right; ++x) {
            if(alpha_at(source, x, y) < 16) {
                continue;
            }
            auto delta_x = x - source_x;
            auto delta_y = y - source_y;
            minimum_squared = std::min(minimum_squared, delta_x * delta_x + delta_y * delta_y);
        }
    }
    if(minimum_squared == std::numeric_limits<int>::max()) {
        return static_cast<double>(search_radius + 1);
    }
    return std::sqrt(static_cast<double>(minimum_squared));
}

auto gaussian(double value, double mean, double sigma) -> double
{
    auto normalized = (value - mean) / sigma;
    return std::exp(-0.5 * normalized * normalized);
}

auto render_frame(XcursorImage const& source, int frame_index, int padding) -> XcursorImage*
{
    auto width = static_cast<int>(source.width) + padding * 2;
    auto height = static_cast<int>(source.height) + padding * 2;
    auto* output = XcursorImageCreate(width, height);
    if(output == nullptr) {
        throw std::runtime_error("failed to allocate cursor animation frame");
    }
    output->version = source.version;
    output->size = source.size;
    output->xhot = source.xhot + padding;
    output->yhot = source.yhot + padding;
    output->delay = animation_frame_delay_ms;

    auto progress = static_cast<double>(frame_index) / (animation_frames - 1);
    auto brightness_envelope = std::pow(std::sin(std::numbers::pi * progress), 1.15);
    auto pulse_radius = 1.3 + 6.7 * progress;
    auto pulse_strength = 0.30 * brightness_envelope;
    auto source_width = static_cast<int>(source.width);
    auto source_height = static_cast<int>(source.height);

    for(auto y = 0; y < height; ++y) {
        for(auto x = 0; x < width; ++x) {
            auto source_x = x - padding;
            auto source_y = y - padding;
            auto distance = nearest_visible_distance(source, source_x, source_y, padding);

            auto color = rgba{};
            auto diffuse_alpha = (0.10 + 0.08 * brightness_envelope) * gaussian(distance, 0.0, 4.0);
            color = over(color, solid_layer(1.0, 1.0, 1.0, diffuse_alpha));

            auto pulse_alpha = pulse_strength * gaussian(distance, pulse_radius, 1.15);
            color = over(color, solid_layer(cyan_red, cyan_green, cyan_blue, pulse_alpha));

            auto edge_alpha = (0.48 + 0.14 * brightness_envelope) * gaussian(distance, 0.9, 0.95);
            color = over(color, solid_layer(cyan_red, cyan_green, cyan_blue, edge_alpha));

            if(source_x >= 0 and source_y >= 0 and source_x < source_width and source_y < source_height) {
                auto source_pixel = source.pixels[static_cast<std::size_t>(source_y) * source.width
                    + static_cast<std::size_t>(source_x)];
                color = over(color, unpack_pixel(source_pixel));
            }
            output->pixels[static_cast<std::size_t>(y) * output->width + static_cast<std::size_t>(x)] = pack_pixel(color);
        }
    }
    return output;
}

auto generate_cursor(fs::path const& source_path, fs::path const& output_path, int requested_size) -> void
{
    auto* source = XcursorFilenameLoadImages(source_path.c_str(), requested_size);
    if(source == nullptr or source->nimage <= 0) {
        if(source != nullptr) {
            XcursorImagesDestroy(source);
        }
        throw std::runtime_error("failed to load Xcursor file: " + source_path.string());
    }

    auto nominal_size = std::max(1, static_cast<int>(source->images[0]->size));
    auto padding = std::max(8, static_cast<int>(std::ceil(nominal_size * 0.3125)));
    auto* output = XcursorImagesCreate(animation_frames);
    if(output == nullptr) {
        XcursorImagesDestroy(source);
        throw std::runtime_error("failed to allocate animated cursor images");
    }
    output->nimage = animation_frames;
    XcursorImagesSetName(output, source_path.filename().c_str());

    try {
        for(auto frame_index = 0; frame_index < animation_frames; ++frame_index) {
            auto elapsed_ms = static_cast<std::uint64_t>(frame_index) * animation_frame_delay_ms;
            output->images[frame_index] = render_frame(source_frame_at(*source, elapsed_ms), frame_index, padding);
        }
        if(not XcursorFilenameSaveImages(output_path.c_str(), output)) {
            throw std::runtime_error("failed to save generated Xcursor file: " + output_path.string());
        }
    } catch(...) {
        XcursorImagesDestroy(output);
        XcursorImagesDestroy(source);
        throw;
    }

    XcursorImagesDestroy(output);
    XcursorImagesDestroy(source);
}

auto write_index(fs::path const& path, std::string const& output_name, std::string const& source_theme, int source_size) -> void
{
    auto stream = std::ofstream{ path };
    if(not stream) {
        throw std::runtime_error("failed to write generated cursor theme index");
    }
    stream << "[Icon Theme]\n"
           << "Name=" << output_name << '\n'
           << "Comment=Codex Computer Use outward edge-light cursor theme\n"
           << "Inherits=" << source_theme << '\n'
           << "X-Codex-BaseTheme=" << source_theme << '\n'
           << "X-Codex-BaseSize=" << source_size << '\n'
           << "X-Codex-Animation=outward-edge-diffusion\n";
    if(not stream) {
        throw std::runtime_error("failed to finish generated cursor theme index");
    }
}

auto install_theme(fs::path const& source_cursors, fs::path const& output, std::string const& output_name,
                   std::string const& source_theme, int source_size) -> int
{
    fs::create_directories(output.parent_path());
    auto temporary = fs::path{ output.string() + ".tmp-" + std::to_string(::getpid()) };
    auto previous = fs::path{ output.string() + ".old-" + std::to_string(::getpid()) };
    fs::remove_all(temporary);
    fs::remove_all(previous);
    fs::create_directories(temporary / "cursors");

    auto generated_count = 0;
    try {
        for(auto const& entry : fs::directory_iterator{ source_cursors }) {
            auto destination = temporary / "cursors" / entry.path().filename();
            if(entry.is_symlink()) {
                fs::create_symlink(fs::read_symlink(entry.path()), destination);
                continue;
            }
            if(not entry.is_regular_file()) {
                continue;
            }
            generate_cursor(entry.path(), destination, source_size);
            ++generated_count;
        }
        if(generated_count == 0) {
            throw std::runtime_error("source cursor theme contains no Xcursor files");
        }
        write_index(temporary / "index.theme", output_name, source_theme, source_size);

        if(fs::exists(output)) {
            fs::rename(output, previous);
        }
        try {
            fs::rename(temporary, output);
        } catch(...) {
            if(fs::exists(previous)) {
                fs::rename(previous, output);
            }
            throw;
        }
        fs::remove_all(previous);
    } catch(...) {
        fs::remove_all(temporary);
        throw;
    }
    return generated_count;
}

} // namespace

auto main(int argc, char* argv[]) -> int
{
    if(argc != 5) {
        std::fprintf(stderr, "usage: %s <source-theme> <source-size> <output-dir> <output-name>\n", argv[0]);
        return 2;
    }
    try {
        auto source_theme = std::string{ argv[1] };
        auto parsed_size = std::size_t{};
        auto source_size = std::stoi(argv[2], &parsed_size);
        if(parsed_size != std::string{ argv[2] }.size() or source_size <= 0 or source_size > 256) {
            throw std::runtime_error("source cursor size must be an integer from 1 to 256");
        }
        auto output = fs::path{ argv[3] };
        auto output_name = std::string{ argv[4] };
        if(output_name.empty() or output_name.find('/') != std::string::npos) {
            throw std::runtime_error("output cursor theme name must be a theme name");
        }
        auto generated_count = install_theme(
            find_cursor_directory(source_theme), output, output_name, source_theme, source_size);
        std::fprintf(
            stdout,
            "generated %d animated cursors from %s at size %d\n",
            generated_count,
            source_theme.c_str(),
            source_size);
        return 0;
    } catch(std::exception const& error) {
        std::fprintf(stderr, "%s\n", error.what());
        return 1;
    }
}
