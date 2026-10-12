#pragma once
#include "MessageBase.h"
#include "MsgType.h"
#include <array>
#include <optional>
#include <type_traits>

struct HostMessage : public MessageBase<HostMessage>
{
  static constexpr auto kMsgType =
    std::integral_constant<char, static_cast<char>(MsgType::Host)>{};

  template <class Archive>
  void Serialize(Archive& archive)
  {
    archive.Serialize("t", kMsgType)
      .Serialize("remoteId", remoteId)
      .Serialize("worldOrCell", worldOrCell)
      .Serialize("pos", pos)
      .Serialize("rot", rot)
      .Serialize("release", release)
      .Serialize("disabled", disabled);
  }

  uint64_t remoteId = 0;
  std::optional<uint32_t> worldOrCell;
  std::optional<std::array<float, 3>> pos;
  std::optional<std::array<float, 3>> rot;
  std::optional<bool> release;
  std::optional<bool> disabled;
};
