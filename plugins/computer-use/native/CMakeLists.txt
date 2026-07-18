cmake_minimum_required(VERSION 3.22)

project(codex_computer_use_helpers LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
find_package(Qt6 6.5 REQUIRED COMPONENTS Core DBus Gui)
pkg_check_modules(XCURSOR REQUIRED IMPORTED_TARGET xcursor)

add_executable(codex-computer-use-screenshot codex-computer-use-screenshot.cpp)
target_link_libraries(
    codex-computer-use-screenshot
    PRIVATE
        Qt6::Core
        Qt6::DBus
        Qt6::Gui
)

add_executable(codex-computer-use-eis codex-computer-use-eis.cpp)
target_link_libraries(
    codex-computer-use-eis
    PRIVATE
        Qt6::Core
        Qt6::DBus
        ${CMAKE_DL_LIBS}
)
target_compile_options(codex-computer-use-eis PRIVATE -Wall -Wextra -Wpedantic)

add_executable(codex-computer-use-glow-theme codex-computer-use-glow.cpp)
target_link_libraries(
    codex-computer-use-glow-theme
    PRIVATE
        PkgConfig::XCURSOR
)
target_compile_options(codex-computer-use-glow-theme PRIVATE -Wall -Wextra -Wpedantic)
