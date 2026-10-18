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

namespace {
void HostAlvor(PartOne& partOne, MpActor& alvor)
{
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.lastMovUpdateByIdx.clear();
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
}

void ReleaseAlvor(PartOne& partOne, MpActor& alvor, uint32_t cell,
                  NiPoint3 pos)
{
  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  alvor.SetCellOrWorld(FormDesc::FromFormId(cell, partOne.worldState.espmFiles));
  alvor.SetPos(pos);
  DisconnectClaimer(partOne);
}

nlohmann::json Movement(uint32_t idx, uint32_t cell, NiPoint3 pos,
                        float health = 1.f, bool isDead = false)
{
  auto j = jMovement;
  j["idx"] = idx;
  j["data"]["worldOrCell"] = cell;
  j["data"]["pos"] = { pos.x, pos.y, pos.z };
  j["data"]["healthPercentage"] = health;
  j["data"]["isDead"] = isDead;
  return j;
}
}

TEST_CASE("An NPC that moves up to 16 cells from its hoster stays hosted and "
          "seen by players, a hoster that moves 2 cells away loses it",
          "[NpcHost][espm][F5]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  const NiPoint3 spot = { 22528.f, -45138.f, -81.f };
  alvor.SetCellOrWorld(
    FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
  alvor.SetPos(spot);
  auto hostStops = [&] {
    return std::count_if(
      partOne.Messages().begin(), partOne.Messages().end(), [](auto& m) {
        return m.userId == 0 && m.j["t"] == MsgType::HostStop &&
          m.j["target"] == 0x100000000 + kAlvor;
      });
  };

  HostAlvor(partOne, alvor);
  DoConnect(partOne, 1);
  partOne.CreateActor(kOtherPlayer, spot, 0, kTamriel);
  partOne.SetUserActor(1, kOtherPlayer);
  auto& other = partOne.worldState.GetFormAt<MpActor>(kOtherPlayer);
  partOne.Messages().clear();
  DoMessage(partOne, 0,
            Movement(alvor.GetIdx(), kTamriel,
                     { spot.x + 16 * 4096.f, spot.y, spot.z }));
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE(alvor.GetListeners().count(&other) == 1);
  partOne.DestroyActor(kOtherPlayer);
  DoDisconnect(partOne, 1);
  REQUIRE(hostStops() == 0);
  DoMessage(partOne, 0,
            Movement(alvor.GetIdx(), kTamriel,
                     { spot.x + 17 * 4096.f, spot.y, spot.z }));
  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE(hostStops() == 1);
  DisconnectClaimer(partOne);

  alvor.SetPos(spot);
  HostAlvor(partOne, alvor);
  partOne.Messages().clear();
  auto& claimer = partOne.worldState.GetFormAt<MpActor>(kClaimer);
  const auto claimerStart = claimer.GetPos();
  DoMessage(partOne, 0,
            Movement(alvor.GetIdx(), kTamriel,
                     { spot.x + 3 * 4096.f, spot.y, spot.z }));
  claimer.SetPos({ claimerStart.x, claimerStart.y + 4096.f, claimerStart.z });
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE(alvor.GetListeners().count(&claimer) == 1);
  REQUIRE(hostStops() == 0);
  claimer.SetPos(claimerStart);
  DoMessage(partOne, 0, Movement(alvor.GetIdx(), kTamriel, spot));
  partOne.Messages().clear();
  claimer.SetPos({ spot.x, spot.y + 2 * 4096.f, spot.z });
  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE(hostStops() == 1);

  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("A hoster's movement moves an NPC to another cell and far away",
          "[NpcHost][espm][1A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);

  const NiPoint3 target = { 20587.f, -45138.f, -81.f };
  DoMessage(partOne, 0, Movement(alvor.GetIdx(), kTamriel, target));

  REQUIRE(CellOf(partOne, alvor) == kTamriel);
  REQUIRE((alvor.GetPos() - target).Length() < 1.f);

  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("A hoster that stops sending movement loses the host",
          "[NpcHost][espm][P2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);

  partOne.Tick();
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  partOne.worldState.lastMovUpdateByIdx[alvor.GetIdx()] =
    std::chrono::system_clock::now() - std::chrono::seconds(10);
  partOne.Tick();
  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE((alvor.GetPos() - start).Length() < 1.f);

  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("A player's own movement is still validated",
          "[NpcHost][espm][1A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  ConnectClaimer(partOne, alvor, cell);
  auto& claimer = partOne.worldState.GetFormAt<MpActor>(kClaimer);
  const auto start = claimer.GetPos();

  DoMessage(partOne, 0,
            Movement(claimer.GetIdx(), cell,
                     start + NiPoint3(5000.f, 0.f, 0.f)));

  REQUIRE((claimer.GetPos() - start).Length() < 1.f);

  DisconnectClaimer(partOne);
}

TEST_CASE("A hoster's movement carries the health and the death of an NPC",
          "[NpcHost][espm][1A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);

  DoMessage(partOne, 0, Movement(alvor.GetIdx(), cell, start, 0.4f));
  REQUIRE(alvor.GetActorValues().healthPercentage == Catch::Approx(0.4f));
  REQUIRE(!alvor.IsDead());

  DoMessage(partOne, 0, Movement(alvor.GetIdx(), cell, start, 0.f, true));
  REQUIRE(alvor.IsDead());

  alvor.SetIsDead(false);
  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("Health 0 alone does not kill an ESP NPC", "[NpcHost][espm][1A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);

  ActorValues zero;
  zero.healthPercentage = 0.f;
  alvor.SetPercentages(zero);
  REQUIRE(!alvor.IsDead());
  alvor.SetPercentage(espm::ActorValue::Health, 0.f);
  REQUIRE(!alvor.IsDead());

  ActorValues full;
  alvor.SetPercentages(full);
}

TEST_CASE("A unique ESP NPC stays dead, a non-unique one respawns",
          "[NpcHost][espm][1A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  auto& guard = partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard);

  alvor.SetRespawnTime(0.f);
  guard.SetRespawnTime(0.f);
  alvor.Kill();
  guard.Kill();
  REQUIRE(alvor.IsDead());
  REQUIRE(guard.IsDead());

  partOne.Tick();

  REQUIRE(alvor.IsDead());
  REQUIRE(!guard.IsDead());

  alvor.SetIsDead(false);
  alvor.SetRespawnTime(MpChangeForm().spawnDelay);
  guard.SetRespawnTime(WorldState::kEspmNpcSpawnDelay);
}

TEST_CASE("A hoster cannot kill an essential ESP NPC or move an NPC to a "
          "record that is not a cell",
          "[NpcHost][espm][1A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  auto& hadvar = partOne.worldState.GetFormAt<MpActor>(kHadvar);
  auto& br = partOne.worldState.GetEspm().GetBrowser();
  REQUIRE(espm::Convert<espm::NPC_>(br.LookupById(hadvar.GetBaseId()).rec)
            ->GetData(partOne.worldState.GetEspmCache())
            .isEssential);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);

  DoMessage(partOne, 0, Movement(alvor.GetIdx(), kAlvor, start));
  REQUIRE(CellOf(partOne, alvor) == cell);
  DoMessage(partOne, 0, Movement(alvor.GetIdx(), 0x00fffff0, start));
  REQUIRE(CellOf(partOne, alvor) == cell);

  partOne.worldState.hosters[kHadvar] = kClaimer;
  partOne.worldState.lastMovUpdateByIdx.clear();
  DoMessage(partOne, 0,
            Movement(hadvar.GetIdx(), CellOf(partOne, hadvar), hadvar.GetPos(),
                     0.f, true));
  REQUIRE(!hadvar.IsDead());

  partOne.worldState.hosters[kHadvar] = 0;
  hadvar.UpdateHoster(0);
  ActorValues full;
  hadvar.SetPercentages(full);
  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("A hoster's stale death right after a server respawn is ignored",
          "[NpcHost][espm][1B.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);

  alvor.SetIsDead(true);
  REQUIRE(alvor.IsDead());
  alvor.SetIsDead(false);
  REQUIRE(!alvor.IsDead());

  DoMessage(partOne, 0, Movement(alvor.GetIdx(), cell, start, 0.f, true));
  REQUIRE(!alvor.IsDead());

  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("A hoster's animation is the last animation of the NPC",
          "[NpcHost][espm][G1.6]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::UpdateAnimation },
                            { "idx", alvor.GetIdx() },
                            { "data",
                              { { "animEventName", "IdleChairFrontEnter" },
                                { "numChanges", 3 } } } });

  auto anim = alvor.GetLastAnimEvent();
  REQUIRE(anim.has_value());
  REQUIRE(anim->animEventName == "IdleChairFrontEnter");
  REQUIRE(anim->numChanges == 3);

  alvor.SetLastAnimEvent(std::nullopt);
  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("An add to an unopened ESP container keeps its base loot",
          "[NpcHost][espm][2A.1]")
{
  auto& partOne = GetNpcHostPartOne();
  constexpr uint32_t kBarrelFish01 = 0x10cd5b;
  constexpr uint32_t kRef = 0xff0a2a01;
  partOne.worldState.AddForm(
    std::make_unique<MpObjectReference>(
      LocationalData(), FormCallbacks::DoNothing(), kBarrelFish01, "CONT"),
    kRef);
  auto& barrel = partOne.worldState.GetFormAt<MpObjectReference>(kRef);
  barrel.SetChanceNoneOverride(0);
  REQUIRE(barrel.GetInventory().IsEmpty());

  barrel.AddItem(0x12eb7, 1);

  REQUIRE(barrel.GetInventory().GetItemCount(0x12eb7) == 1);
  const auto total = barrel.GetInventory().GetTotalItemCount();
  REQUIRE(total > 1);

  barrel.AddItem(0x12eb7, 1);
  REQUIRE(barrel.GetInventory().GetTotalItemCount() == total + 1);

  partOne.worldState.DestroyForm(kRef);
}

TEST_CASE("A player opens a dead ESP NPC, takes an item and closes it, "
          "but cannot open a dead player",
          "[NpcHost][espm][2A.1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& guard = partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard);
  ConnectClaimer(partOne, guard, CellOf(partOne, guard));
  auto& player = partOne.worldState.GetFormAt<MpActor>(kClaimer);
  player.RemoveAllItems();
  auto activate = [&](bool second) {
    DoMessage(partOne, 0,
              nlohmann::json{ { "t", MsgType::Activate },
                              { "data",
                                { { "caster", 0x14 },
                                  { "target", kCrimeFactionGuard },
                                  { "isSecondActivation", second } } } });
  };
  auto opened = [&] {
    return std::any_of(
      partOne.Messages().begin(), partOne.Messages().end(), [](auto& m) {
        return m.j["t"] == MsgType::OpenContainer &&
          m.j["target"] == kCrimeFactionGuard;
      });
  };
  auto inventorySent = [&] {
    return std::any_of(
      partOne.Messages().begin(), partOne.Messages().end(), [&](auto& m) {
        return m.j["t"] == MsgType::UpdateProperty &&
          m.j["propName"] == "inventory" && m.j["idx"] == guard.GetIdx();
      });
  };
  REQUIRE(!guard.GetInventory().IsEmpty());
  const auto item = guard.GetInventory().entries.front().baseId;
  const auto count = guard.GetInventory().GetItemCount(item);

  partOne.Messages().clear();
  activate(false);
  REQUIRE(!opened());

  partOne.Messages().clear();
  guard.Kill();
  REQUIRE(inventorySent());
  partOne.Messages().clear();
  activate(false);
  REQUIRE(opened());

  partOne.Messages().clear();
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::TakeItem },
                            { "baseId", item },
                            { "count", 1 },
                            { "target", kCrimeFactionGuard } });
  REQUIRE(player.GetInventory().GetItemCount(item) == 1);
  REQUIRE(guard.GetInventory().GetItemCount(item) == count - 1);
  REQUIRE(inventorySent());

  activate(true);
  REQUIRE_THROWS_WITH(
    guard.TakeItem(player, { item, 1 }),
    Catch::Matchers::ContainsSubstring("doesn't occupy"));

  partOne.CreateActor(kOtherPlayer, guard.GetPos(), 0,
                      CellOf(partOne, guard));
  auto& other = partOne.worldState.GetFormAt<MpActor>(kOtherPlayer);
  other.AddItem(item, 1);
  other.Kill();
  partOne.Messages().clear();
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Activate },
                            { "data",
                              { { "caster", 0x14 },
                                { "target", kOtherPlayer },
                                { "isSecondActivation", false } } } });
  REQUIRE(std::none_of(
    partOne.Messages().begin(), partOne.Messages().end(),
    [](auto& m) { return m.j["t"] == MsgType::OpenContainer; }));
  partOne.DestroyActor(kOtherPlayer);

  guard.AddItem(item, 1);
  guard.SetIsDead(false);
  DisconnectClaimer(partOne);
}

namespace {
class TakeItemBlocker : public PartOneListener
{
public:
  void OnConnect(Networking::UserId) override {}
  void OnDisconnect(Networking::UserId) override {}
  void OnCustomPacket(Networking::UserId,
                      const simdjson::dom::element&) override
  {
  }
  bool OnMpApiEvent(const GameModeEvent& event) override
  {
    return !block || event.GetName() != std::string("onTakeItem");
  }

  bool block = true;
};
}

TEST_CASE("A blocked take from a dead ESP NPC sends its inventory again",
          "[NpcHost][espm][2A.4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& guard = partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard);
  ConnectClaimer(partOne, guard, CellOf(partOne, guard));
  auto& player = partOne.worldState.GetFormAt<MpActor>(kClaimer);
  player.RemoveAllItems();
  auto blocker = std::make_shared<TakeItemBlocker>();
  partOne.AddListener(blocker);
  auto activate = [&](bool second) {
    DoMessage(partOne, 0,
              nlohmann::json{ { "t", MsgType::Activate },
                              { "data",
                                { { "caster", 0x14 },
                                  { "target", kCrimeFactionGuard },
                                  { "isSecondActivation", second } } } });
  };
  guard.Kill();
  activate(false);
  REQUIRE(!guard.GetInventory().IsEmpty());
  const auto item = guard.GetInventory().entries.front().baseId;
  const auto count = guard.GetInventory().GetItemCount(item);

  partOne.Messages().clear();
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::TakeItem },
                            { "baseId", item },
                            { "count", 1 },
                            { "target", kCrimeFactionGuard } });
  REQUIRE(guard.GetInventory().GetItemCount(item) == count);
  REQUIRE(player.GetInventory().GetItemCount(item) == 0);
  REQUIRE(std::any_of(
    partOne.Messages().begin(), partOne.Messages().end(), [&](auto& m) {
      return m.j["t"] == MsgType::UpdateProperty &&
        m.j["propName"] == "inventory" && m.j["idx"] == guard.GetIdx();
    }));

  blocker->block = false;
  activate(true);
  guard.SetIsDead(false);
  DisconnectClaimer(partOne);
}

TEST_CASE("Disabling and enabling an ESP NPC or ref tells the listeners",
          "[NpcHost][espm][2A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& guard = partOne.worldState.GetFormAt<MpActor>(kCrimeFactionGuard);
  auto& barrel = partOne.worldState.GetFormAt<MpObjectReference>(0x20570);
  for (MpObjectReference* refr :
       { static_cast<MpObjectReference*>(&guard), &barrel }) {
    ConnectClaimer(partOne, *refr, CellOf(partOne, *refr));
    auto sent = [&](const char* value) {
      return std::any_of(
        partOne.Messages().begin(), partOne.Messages().end(), [&](auto& m) {
          return m.j["t"] == MsgType::UpdateProperty &&
            m.j["propName"] == "isDisabled" &&
            m.j["idx"] == refr->GetIdx() && m.j["dataDump"] == value;
        });
    };
    partOne.Messages().clear();
    refr->Disable();
    REQUIRE(refr->IsDisabled());
    REQUIRE(sent("true"));
    partOne.Messages().clear();
    refr->Enable();
    REQUIRE(!refr->IsDisabled());
    REQUIRE(sent("false"));
    DisconnectClaimer(partOne);
  }
}
