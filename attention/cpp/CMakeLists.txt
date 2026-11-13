# Build the attention C ABI as a native static library and a test
# executable. Compiles cleanly under MSVC, MinGW, clang and gcc with
# warnings as errors. Emscripten uses the same sources via
# scripts/build-attention.mjs (its own flags); CMake is not used for wasm.
cmake_minimum_required(VERSION 3.20)
project(attention_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if (MSVC)
    add_compile_options(/W4 /WX)
else()
    add_compile_options(-Wall -Wextra -Werror)
endif()

add_library(attention_native STATIC
    api.cpp
)
target_include_directories(attention_native PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

add_executable(attention_tests
    test/main.cpp
    test/test_vectors.cpp
)
target_link_libraries(attention_tests PRIVATE attention_native)
target_include_directories(attention_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(attention_tests PRIVATE
    ATTENTION_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/test/golden"
)

enable_testing()
add_test(NAME attention_tests COMMAND attention_tests)
