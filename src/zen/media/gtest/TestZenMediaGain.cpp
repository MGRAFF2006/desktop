/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "gtest/gtest.h"
#include "mozilla/ZenMediaGain.h"

TEST(ZenMediaGain, DefaultIsBitPreserving) {
  // Even out-of-range decoder samples must be unchanged when boost is off.
  float samples[] = {-1.25f, -0.25f, 0.0f, 0.25f, 1.25f};
  const float original[] = {-1.25f, -0.25f, 0.0f, 0.25f, 1.25f};
  mozilla::ApplyZenMediaGain(samples, 5, 100);
  for (size_t i = 0; i < 5; ++i) {
    EXPECT_FLOAT_EQ(samples[i], original[i]);
  }
}

TEST(ZenMediaGain, AmplifiesAndSaturatesBothChannels) {
  float samples[] = {-0.75f, 0.75f, -0.125f, 0.125f, 0.0f};
  mozilla::ApplyZenMediaGain(samples, 5, 200);
  EXPECT_FLOAT_EQ(samples[0], -1.0f);
  EXPECT_FLOAT_EQ(samples[1], 1.0f);
  EXPECT_FLOAT_EQ(samples[2], -0.25f);
  EXPECT_FLOAT_EQ(samples[3], 0.25f);
  EXPECT_FLOAT_EQ(samples[4], 0.0f);
}

TEST(ZenMediaGain, InvalidPreferencesCannotExceedBoundedGain) {
  float samples[] = {-0.25f, 0.25f};
  mozilla::ApplyZenMediaGain(samples, 2, -1);
  EXPECT_FLOAT_EQ(samples[0], -0.25f);
  EXPECT_FLOAT_EQ(samples[1], 0.25f);
  mozilla::ApplyZenMediaGain(samples, 2, 1000000);
  EXPECT_FLOAT_EQ(samples[0], -0.5f);
  EXPECT_FLOAT_EQ(samples[1], 0.5f);
}

TEST(ZenMediaGain, ProcessesOnlyWrittenFrames) {
  float samples[] = {0.25f, -0.25f, 0.5f};
  mozilla::ApplyZenMediaGain(samples, 2, 150);
  EXPECT_FLOAT_EQ(samples[0], 0.375f);
  EXPECT_FLOAT_EQ(samples[1], -0.375f);
  EXPECT_FLOAT_EQ(samples[2], 0.5f);
}
