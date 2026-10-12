#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include "libespm/Loader.h"

PartOne& GetPartOne();

namespace {
constexpr uint32_t kAlvor = 0x13482;
constexpr uint32_t kHadvar = 0x2bfa2;
constexpr uint32_t kCrimeFactionGuard = 0x654fa;
constexpr uint32_t kInitiallyDisabledGuard = 0x215d7;
constexpr uint32_t kMannequin = 0x1028fd;
constexpr uint32_t kUndeadDragon = 0x83588;
constexpr uint32_t kMirmulnir = 0x5a6ca;
constexpr uint32_t kStartsDeadNpc = 0x133a8;
constexpr uint32_t kDeletedRef = 0x2bd60;

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
          "[NpcHost][espm][1A.1]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kAlvor));
  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kHadvar));
  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard));

  auto& br = partOne.worldState.GetEspm().GetBrowser();
  auto& cache = partOne.worldState.GetEspmCache();
  auto guard = br.LookupById(kCrimeFactionGuard);
  auto base = br.LookupById(guard.ToGlobalId(
    reinterpret_cast<const espm::REFR*>(guard.rec)->GetData(cache).baseId));
  auto crimeList = br.LookupById(0x26953);
  std::vector<uint32_t> crimeFactions;
  for (auto id : espm::Convert<espm::FLST>(crimeList.rec)->GetData(cache).formIds) {
    crimeFactions.push_back(crimeList.ToGlobalId(id));
  }
  auto factions = espm::Convert<espm::NPC_>(base.rec)->GetData(cache).factions;
  REQUIRE(std::any_of(factions.begin(), factions.end(), [&](auto& f) {
    return std::find(crimeFactions.begin(), crimeFactions.end(),
                     base.ToGlobalId(f.formId)) != crimeFactions.end();
  }));
}

TEST_CASE("An initially disabled NPC loads disabled",
          "[NpcHost][espm][1A.1]")
{
  auto& partOne = GetNpcHostPartOne();

  auto& guard = partOne.worldState.GetFormAt<MpActor>(kInitiallyDisabledGuard);
  REQUIRE(partOne.worldState.GetEspm()
            .GetBrowser()
            .LookupById(kInitiallyDisabledGuard)
            .rec->GetFlags() &
          0x800);
  REQUIRE(guard.IsDisabled());
  REQUIRE(!partOne.worldState.GetFormAt<MpActor>(kAlvor).IsDisabled());
}

TEST_CASE("Non-unique ESP NPCs respawn after 12 hours, unique keep the default",
          "[NpcHost][espm][1A.1]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE(WorldState::kEspmNpcSpawnDelay == 43200.f);
  REQUIRE(partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard)
            .GetRespawnTime() == WorldState::kEspmNpcSpawnDelay);
  REQUIRE(partOne.worldState.GetFormAt<MpActor>(kAlvor).GetRespawnTime() ==
          MpChangeForm().spawnDelay);
}

TEST_CASE("Mannequin and undead dragon races stay banned",
          "[NpcHost][espm][1A.1]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE_THROWS_WITH(partOne.worldState.GetFormAt<MpActor>(kMannequin),
                      Catch::Matchers::ContainsSubstring("Form with id"));
  REQUIRE_THROWS_WITH(partOne.worldState.GetFormAt<MpActor>(kUndeadDragon),
                      Catch::Matchers::ContainsSubstring("Form with id"));
  for (auto id : { kMannequin, kUndeadDragon }) {
    std::stringstream trace;
    REQUIRE(!partOne.worldState.LookupFormById(id, &trace));
    REQUIRE_THAT(trace.str(),
                 Catch::Matchers::ContainsSubstring("banned race"));
  }
  REQUIRE(WorldState().bannedEspmCharacterRaceIds ==
          std::vector<uint32_t>{ 0xe7713, 0x1052a3, 0x10760a });
}

TEST_CASE("Mirmulnir, a DragonRace NPC, loads disabled",
          "[NpcHost][espm][1A.1]")
{
  auto& partOne = GetNpcHostPartOne();

  REQUIRE_NOTHROW(partOne.worldState.GetFormAt<MpActor>(kMirmulnir));
  REQUIRE(partOne.worldState.GetFormAt<MpActor>(kMirmulnir).IsDisabled());
}

TEST_CASE("StartsDead NPCs and deleted refs stay skipped",
          "[NpcHost][espm][1A.1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& browser = partOne.worldState.GetEspm().GetBrowser();
  REQUIRE(browser.LookupById(kStartsDeadNpc).rec->GetFlags() & 0x200);
  REQUIRE(browser.LookupById(kDeletedRef).rec->GetFlags() & 0x20);

  REQUIRE_THROWS_WITH(partOne.worldState.GetFormAt<MpActor>(kStartsDeadNpc),
                      Catch::Matchers::ContainsSubstring("Form with id"));
  REQUIRE_THROWS_WITH(
    partOne.worldState.GetFormAt<MpObjectReference>(kDeletedRef),
    Catch::Matchers::ContainsSubstring("Form with id"));

  std::stringstream deadTrace, deletedTrace;
  REQUIRE(!partOne.worldState.LookupFormById(kStartsDeadNpc, &deadTrace));
  REQUIRE_THAT(deadTrace.str(),
               Catch::Matchers::ContainsSubstring("skips dead actors"));
  REQUIRE(!partOne.worldState.LookupFormById(kDeletedRef, &deletedTrace));
  REQUIRE_THAT(deletedTrace.str(),
               Catch::Matchers::ContainsSubstring("skips deleted references"));
}

TEST_CASE("A host attempt on an NPC with a high idx records its time",
          "[NpcHost][espm][1A.2]")
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

namespace {
constexpr uint32_t kClaimer = 0xff000000;
constexpr uint32_t kOtherPlayer = 0xff000001;
constexpr uint32_t kTamriel = 0x3c;

uint32_t CellOf(PartOne& partOne, MpObjectReference& refr)
{
  return refr.GetCellOrWorld().ToFormId(partOne.worldState.espmFiles);
}

void ConnectClaimer(PartOne& partOne, MpObjectReference& origin,
                    uint32_t cellOrWorld)
{
  DoConnect(partOne, 0);
  partOne.CreateActor(kClaimer, origin.GetPos(), 0, cellOrWorld);
  partOne.SetUserActor(0, kClaimer);
}

void DisconnectClaimer(PartOne& partOne)
{
  partOne.DestroyActor(kClaimer);
  DoDisconnect(partOne, 0);
}

nlohmann::json Claim(uint32_t npc, uint32_t cellOrWorld, NiPoint3 pos)
{
  return nlohmann::json{ { "t", MsgType::Host },
                         { "remoteId", 0x100000000 + npc },
                         { "worldOrCell", cellOrWorld },
                         { "pos", { pos.x, pos.y, pos.z } },
                         { "rot", { 0.f, 0.f, 0.f } } };
}
}

TEST_CASE("A location claim enables the NPC and moves it to the claim",
          "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& guard = partOne.worldState.GetFormAt<MpActor>(kInitiallyDisabledGuard);
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto guardCell = CellOf(partOne, guard);
  const auto start = guard.GetPos();
  const auto cell = CellOf(partOne, alvor);
  REQUIRE(guardCell != cell);
  partOne.worldState.hosters[kInitiallyDisabledGuard] = 0;
  ConnectClaimer(partOne, alvor, cell);

  const NiPoint3 target = alvor.GetPos() + NiPoint3(50.f, 0.f, 0.f);
  DoMessage(partOne, 0, Claim(kInitiallyDisabledGuard, cell, target));

  REQUIRE(partOne.worldState.hosters[kInitiallyDisabledGuard] == kClaimer);
  REQUIRE(!guard.IsDisabled());
  REQUIRE((guard.GetPos() - target).Length() < 1.f);
  REQUIRE(CellOf(partOne, guard) == cell);

  partOne.worldState.hosters[kInitiallyDisabledGuard] = 0;
  guard.UpdateHoster(0);
  guard.SetCellOrWorld(
    FormDesc::FromFormId(guardCell, partOne.worldState.espmFiles));
  guard.SetPos(start);
  guard.Disable();
  DisconnectClaimer(partOne);
}

TEST_CASE("A location claim is rejected from another cell, from too far, or "
          "with a location that is not a cell or a worldspace",
          "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();

  SECTION("another cell")
  {
    ConnectClaimer(partOne, alvor, kTamriel);
    DoMessage(partOne, 0, Claim(kAlvor, cell, start));
  }
  SECTION("too far")
  {
    ConnectClaimer(partOne, alvor, cell);
    DoMessage(partOne, 0,
              Claim(kAlvor, cell, { start.x + 5000.f, start.y, start.z }));
  }
  SECTION("not a cell or a worldspace")
  {
    ConnectClaimer(partOne, alvor, cell);
    DoMessage(partOne, 0, Claim(kAlvor, kAlvor, start));
  }
  SECTION("no position")
  {
    ConnectClaimer(partOne, alvor, cell);
    auto claim = Claim(kAlvor, cell, start);
    claim.erase("pos");
    DoMessage(partOne, 0, claim);
  }

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE((alvor.GetPos() - start).Length() < 1.f);
  REQUIRE(CellOf(partOne, alvor) == cell);

  DisconnectClaimer(partOne);
}

TEST_CASE("Nobody can host the actor of a player", "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  ConnectClaimer(partOne, alvor, cell);
  DoConnect(partOne, 1);
  partOne.CreateActor(kOtherPlayer, alvor.GetPos(), 0, cell);
  partOne.SetUserActor(1, kOtherPlayer);

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", kOtherPlayer } });
  DoMessage(partOne, 0, Claim(kOtherPlayer, cell, alvor.GetPos()));

  REQUIRE(partOne.worldState.hosters[kOtherPlayer] == 0);

  partOne.DestroyActor(kOtherPlayer);
  DoDisconnect(partOne, 1);
  DisconnectClaimer(partOne);
}

TEST_CASE("The hoster releases an NPC, optionally disabled",
          "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  const bool disable = GENERATE(false, true);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor },
                            { "release", true },
                            { "disabled", disable } });

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE(alvor.IsDisabled() == disable);

  alvor.Enable();
  DisconnectClaimer(partOne);
}

TEST_CASE("Only the hoster can release an NPC", "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, cell);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });
  DoConnect(partOne, 1);
  partOne.CreateActor(kOtherPlayer, alvor.GetPos(), 0, cell);
  partOne.SetUserActor(1, kOtherPlayer);

  DoMessage(partOne, 1,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor },
                            { "release", true },
                            { "disabled", true } });

  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE(!alvor.IsDisabled());

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  partOne.DestroyActor(kOtherPlayer);
  DoDisconnect(partOne, 1);
  DisconnectClaimer(partOne);
}

TEST_CASE("A hoster that leaves the grid of the NPC loses the host",
          "[NpcHost][espm][1A.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  partOne.Messages().clear();

  auto& claimer = partOne.worldState.GetFormAt<MpActor>(kClaimer);
  claimer.SetCellOrWorld(
    FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
  claimer.SetPos({ 0.f, 0.f, 0.f });

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE(std::any_of(
    partOne.Messages().begin(), partOne.Messages().end(), [](auto& m) {
      return m.userId == 0 && m.j["t"] == MsgType::HostStop &&
        m.j["target"] == 0x100000000 + kAlvor;
    }));

  DisconnectClaimer(partOne);
}

TEST_CASE("A hoster that disconnects loses the host", "[NpcHost][espm][1A.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  DoDisconnect(partOne, 0);

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);

  partOne.DestroyActor(kClaimer);
}

TEST_CASE("A location claim cannot take an NPC from a hoster that moved it "
          "in the last 2 s",
          "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, cell);
  DoConnect(partOne, 1);
  partOne.CreateActor(kOtherPlayer, start, 0, cell);
  partOne.SetUserActor(1, kOtherPlayer);

  DoMessage(partOne, 0, Claim(kAlvor, cell, start));
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  DoMessage(partOne, 1,
            Claim(kAlvor, cell, start + NiPoint3(30.f, 0.f, 0.f)));

  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE((alvor.GetPos() - start).Length() < 1.f);

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  partOne.DestroyActor(kOtherPlayer);
  DoDisconnect(partOne, 1);
  DisconnectClaimer(partOne);
}

TEST_CASE("A location claim on an object that is not an NPC is rejected",
          "[NpcHost][espm][1A.2]")
{
  constexpr uint32_t kBleakFallsGate = 0x3b9f1;
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  auto& gate = partOne.worldState.GetFormAt<MpObjectReference>(kBleakFallsGate);
  const auto gateCell = CellOf(partOne, gate);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kBleakFallsGate] = 0;
  ConnectClaimer(partOne, alvor, cell);

  DoMessage(partOne, 0, Claim(kBleakFallsGate, cell, alvor.GetPos()));

  REQUIRE(partOne.worldState.hosters[kBleakFallsGate] == 0);
  REQUIRE(CellOf(partOne, gate) == gateCell);

  DisconnectClaimer(partOne);
}

TEST_CASE("A player who is not the hoster leaves, and the hoster stays",
          "[NpcHost][espm][1A.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, cell);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });
  DoConnect(partOne, 1);
  partOne.CreateActor(kOtherPlayer, alvor.GetPos(), 0, cell);
  partOne.SetUserActor(1, kOtherPlayer);

  auto& other = partOne.worldState.GetFormAt<MpActor>(kOtherPlayer);
  other.SetCellOrWorld(
    FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
  other.SetPos({ 0.f, 0.f, 0.f });
  DoDisconnect(partOne, 1);

  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  partOne.DestroyActor(kOtherPlayer);
  DisconnectClaimer(partOne);
}
