#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

PartOne& GetPartOne();

namespace {
constexpr uint32_t kAlvor = 0x13482;
constexpr uint32_t kHadvar = 0x2bfa2;
constexpr uint32_t kCrimeFactionGuard = 0x654fa;
constexpr uint32_t kInitiallyDisabledGuard = 0x215d7;
constexpr uint32_t kMannequin = 0x1028fd;
constexpr uint32_t kUndeadDragon = 0x83588;

PartOne& GetNpcHostPartOne()
{
  auto& partOne = GetPartOne();
  partOne.worldState.npcEnabled = true;
  partOne.worldState.bannedEspmCharacterRaceIds =
    WorldState().bannedEspmCharacterRaceIds;
  return partOne;
}
}

TEST_CASE("Unique, essential and crime faction NPCs load",
          "[NpcHost][espm]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kAlvor));
  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kHadvar));
  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard));
}

TEST_CASE("An initially disabled NPC loads disabled", "[NpcHost][espm]")
{
  auto& partOne = GetNpcHostPartOne();

  auto& guard = partOne.worldState.GetFormAt<MpActor>(kInitiallyDisabledGuard);
  REQUIRE(guard.IsDisabled());
  REQUIRE(!partOne.worldState.GetFormAt<MpActor>(kAlvor).IsDisabled());
}

TEST_CASE("Non-unique ESP NPCs respawn after 12 hours, unique keep the default",
          "[NpcHost][espm]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE(partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard)
            .GetRespawnTime() == WorldState::kEspmNpcSpawnDelay);
  REQUIRE(partOne.worldState.GetFormAt<MpActor>(kAlvor).GetRespawnTime() ==
          MpChangeForm().spawnDelay);
}

TEST_CASE("Mannequin and undead dragon races stay banned", "[NpcHost][espm]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE_THROWS_WITH(partOne.worldState.GetFormAt<MpActor>(kMannequin),
                      Catch::Matchers::ContainsSubstring("Form with id"));
  REQUIRE_THROWS_WITH(partOne.worldState.GetFormAt<MpActor>(kUndeadDragon),
                      Catch::Matchers::ContainsSubstring("Form with id"));
}

TEST_CASE("A host attempt on an NPC with a high idx records its time",
          "[NpcHost][espm]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.lastMovUpdateByIdx.clear();

  DoConnect(partOne, 0);
  partOne.CreateActor(0xff000000, alvor.GetPos(), 0,
                      alvor.GetCellOrWorld().ToFormId(
                        partOne.worldState.espmFiles));
  partOne.SetUserActor(0, 0xff000000);

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0xff000000);
  REQUIRE(partOne.worldState.lastMovUpdateByIdx.size() > alvor.GetIdx());

  partOne.DestroyActor(0xff000000);
  DoDisconnect(partOne, 0);
}
