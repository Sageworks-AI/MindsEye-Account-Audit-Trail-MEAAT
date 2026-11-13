// Portable export macro for the C ABI. On Windows/MSVC, `__attribute__` is
// not a keyword and would fail to compile; on GCC/Clang/MinGW it is the
// standard way to ensure default visibility. Emscripten uses the GCC path,
// and the build script passes -sEXPORTED_FUNCTIONS so symbols are reachable
// from JS regardless. The macro below resolves to the right thing on each
// toolchain with no ifdefs leaking into api.cpp.
#ifndef SPACE_CPP_EXPORT_HPP
#define SPACE_CPP_EXPORT_HPP

#if defined(_MSC_VER)
#  define SPACE_EXPORT extern "C" __declspec(dllexport)
#elif defined(__GNUC__) || defined(__clang__)
#  define SPACE_EXPORT extern "C" __attribute__((visibility("default")))
#else
#  define SPACE_EXPORT extern "C"
#endif

#endif
