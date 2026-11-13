# Build the space C ABI as a native static library and a test executable.
# Compiles cleanly under MSVC, MinGW, clang and gcc with warnings as errors.
# Emscripten uses the same sources via scripts/build-space.mjs (which passes
# its own flags); CMake is not used for the wasm build.
cmake_minimum_required(VERSION 3.20)
project(space_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if (MSVC)
    add_compile_options(/W4 /WX)
else()
    add_compile_options(-Wall -Wextra -Werror)
endif()

add_library(space_native STATIC
    cpp/api.cpp
)
target_include_directories(space_native PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/cpp)

add_executable(space_tests
    cpp/test/main.cpp
    cpp/test/test_vectors.cpp
)
target_link_libraries(space_tests PRIVATE space_native)
target_include_directories(space_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/cpp)
target_compile_definitions(space_tests PRIVATE
    SPACE_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/cpp/test/golden"
)

enable_testing()
add_test(NAME space_tests COMMAND space_tests)
