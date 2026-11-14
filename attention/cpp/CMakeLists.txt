# Build the attention C ABI as a native STATIC library (for the test
# executable) and a SHARED library (for `conductor/abi.py`'s ctypes path).
# Compiles cleanly under MSVC, MinGW, clang and gcc with warnings as errors.
# Emscripten uses the same sources via scripts/build-attention.mjs (its own
# flags); CMake is not used for wasm.
#
# S9 adds the SHARED target. Both targets compile api.cpp with the same
# headers; on MSVC the shared library name is attention_native.dll, on
# Unix it is libattention_native.{so,dylib}. `conductor/abi.py` looks in
# the obvious build/ subdirectories for those filenames.
cmake_minimum_required(VERSION 3.20)
project(attention_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if (MSVC)
    add_compile_options(/W4 /WX)
    # Export symbols from the shared library on Windows.
    add_compile_definitions(ATT_SHARED_BUILD)
else()
    add_compile_options(-Wall -Wextra -Werror -fPIC)
endif()

add_library(attention_native STATIC api.cpp)
target_include_directories(attention_native PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

add_library(attention_native_shared SHARED api.cpp)
target_include_directories(attention_native_shared PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
set_target_properties(attention_native_shared PROPERTIES
    OUTPUT_NAME attention_native
    PREFIX "lib"
)

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
