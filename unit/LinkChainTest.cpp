#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>

#include "MpObjectReference.h"
#include "script_classes/PapyrusObjectReference.h"
#include "script_objects/EspmGameObject.h"
#include "script_objects/MpFormGameObject.h"

PartOne& GetPartOne();

TEST_CASE("DisableLinkChain and EnableLinkChain follow the links with the "
          "keyword",
          "[2B.2]")
{
  constexpr uint32_t kActivator = 0xc744b;
  constexpr uint32_t kTwoStateCollisionKeyword = 0x1051e5;
  constexpr uint32_t kFirstCollision = 0x1051ea;
  constexpr uint32_t kSecondCollision = 0x1051eb;

  auto& partOne = GetPartOne();
  auto& activator =
    partOne.worldState.GetFormAt<MpObjectReference>(kActivator);
  auto& first =
    partOne.worldState.GetFormAt<MpObjectReference>(kFirstCollision);
  auto& second =
    partOne.worldState.GetFormAt<MpObjectReference>(kSecondCollision);
  EspmGameObject keyword(
    partOne.worldState.GetEspm().GetBrowser().LookupById(
      kTwoStateCollisionKeyword));
  PapyrusObjectReference papyrus;

  auto linked = papyrus.GetLinkedRef(activator.ToVarValue(),
                                     { VarValue(&keyword) });
  REQUIRE(GetFormPtr<MpObjectReference>(linked) == &first);

  papyrus.DisableLinkChain(activator.ToVarValue(),
                           { VarValue(&keyword), VarValue(false) });
  REQUIRE(first.IsDisabled());
  REQUIRE(second.IsDisabled());
  REQUIRE(!activator.IsDisabled());

  papyrus.EnableLinkChain(activator.ToVarValue(), { VarValue(&keyword) });
  REQUIRE(!first.IsDisabled());
  REQUIRE(!second.IsDisabled());
}

TEST_CASE("GetLinkedRef picks the link with the keyword", "[2B.2]")
{
  constexpr uint32_t kRackActivator = 0xeb670;
  constexpr uint32_t kRackTriggerKeyword = 0x6d95e;
  constexpr uint32_t kRack = 0xeb675;
  constexpr uint32_t kShield = 0xeb678;

  auto& partOne = GetPartOne();
  auto& activator =
    partOne.worldState.GetFormAt<MpObjectReference>(kRackActivator);
  EspmGameObject keyword(
    partOne.worldState.GetEspm().GetBrowser().LookupById(kRackTriggerKeyword));
  PapyrusObjectReference papyrus;

  auto byKeyword =
    papyrus.GetLinkedRef(activator.ToVarValue(), { VarValue(&keyword) });
  REQUIRE(GetFormPtr<MpObjectReference>(byKeyword) ==
          &partOne.worldState.GetFormAt<MpObjectReference>(kRack));
  auto plain = papyrus.GetLinkedRef(activator.ToVarValue(), {});
  REQUIRE(GetFormPtr<MpObjectReference>(plain) ==
          &partOne.worldState.GetFormAt<MpObjectReference>(kShield));
}
