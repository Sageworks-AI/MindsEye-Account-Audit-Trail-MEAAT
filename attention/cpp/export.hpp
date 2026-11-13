// Portable export macro for the C ABI. On Windows/MSVC, __attribute__ is not
// a keyword and would fail to compile; on GCC/Clang/MinGW it is the standard
// way to force default visibility. Emscripten uses the GCC path and the
// build script additionally passes -sEXPORTED_FUNCTIONS so symbols reach JS
// regardless. The macro hides the toolchain difference from api.cpp.
#ifndef ATTENTION_CPP_EXPORT_HPP
#define ATTENTION_CPP_EXPORT_HPP

#if defined(_MSC_VER)
#  define ATT_EXPORT extern "C" __declspec(dllexport)
#elif defined(__GNUC__) || defined(__clang__)
#  define ATT_EXPORT extern "C" __attribute__((visibility("default")))
#else
#  define ATT_EXPORT extern "C"
#endif

#endif
