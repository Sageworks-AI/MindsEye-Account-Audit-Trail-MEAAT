// This file exists only to document the exact correct body of emit_id so the
// previous file's typo can be corrected without losing context. Paste the
// body below into `attention/cpp/cstr.hpp`, replacing the version that
// currently reads `off_of(offset)`.
//
//   inline bool emit_id(int64_t* out, int64_t outLen, int64_t* offset,
//                       int32_t cpLen, const int32_t* cp) {
//       if (!out || !offset) return false;
//       if (cpLen < 0 || cpLen > ATT_MAX_ID_CP) return false;
//       int64_t off = *offset;
//       if (off + 1 + cpLen > outLen) return false;
//       out[off++] = cpLen;
//       for (int32_t i = 0; i < cpLen; ++i) out[off++] = cp[i];
//       *offset = off;
//       return true;
//   }
//
// Do not add this file to a build; it is documentation only.
