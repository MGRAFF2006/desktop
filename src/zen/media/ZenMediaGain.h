/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_ZenMediaGain_h
#define mozilla_ZenMediaGain_h

#include <algorithm>
#include <cstddef>
#include <cstdint>

namespace mozilla {

// Called after decoding, before cubeb's [0, 1] stream volume. Applying gain
// here avoids Web Audio's cross-origin media restrictions. Full-scale samples
// saturate rather than overflowing. 100% leaves the original samples intact.
inline void ApplyZenMediaGain(float* aSamples, size_t aCount, int32_t aPercent) {
  const float gain = std::clamp(aPercent, 100, 200) / 100.0f;
  if (gain == 1.0f) {
    return;
  }
  for (size_t i = 0; i < aCount; ++i) {
    aSamples[i] = std::clamp(aSamples[i] * gain, -1.0f, 1.0f);
  }
}

}  // namespace mozilla

#endif
