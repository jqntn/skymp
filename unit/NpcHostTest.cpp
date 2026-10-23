#include "TestUtils.hpp"
#include <catch2/catch_all.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include "libespm/Loader.h"
#include <thread>

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

namespace {
constexpr uint32_t kClaimer = 0xff000000;
constexpr uint32_t kOtherPlayer = 0xff000001;
constexpr uint32_t kThirdPlayer = 0xff000003;
constexpr uint32_t kServerNpc = 0xff000002;
constexpr uint32_t kTamriel = 0x3c;
const NiPoint3 kRiverwoodSpot = { 22528.f, -45138.f, -81.f };

uint32_t CellOf(PartOne& partOne, MpObjectReference& refr)
{
  return refr.GetCellOrWorld().ToFormId(partOne.worldState.espmFiles);
}

MpActor& ConnectPlayer(PartOne& partOne, Networking::UserId userId,
                       uint32_t formId, NiPoint3 pos, uint32_t cellOrWorld)
{
  DoConnect(partOne, userId);
  partOne.CreateActor(formId, pos, 0, cellOrWorld);
  partOne.SetUserActor(userId, formId);
  partOne.serverState.userInfo[userId]->lastMovementAt =
    std::chrono::steady_clock::now();
  return partOne.worldState.GetFormAt<MpActor>(formId);
}

void DisconnectPlayer(PartOne& partOne, Networking::UserId userId,
                      uint32_t formId)
{
  partOne.DestroyActor(formId);
  DoDisconnect(partOne, userId);
}

void ConnectClaimer(PartOne& partOne, MpObjectReference& origin,
                    uint32_t cellOrWorld)
{
  ConnectPlayer(partOne, 0, kClaimer, origin.GetPos(), cellOrWorld);
}

void DisconnectClaimer(PartOne& partOne)
{
  DisconnectPlayer(partOne, 0, kClaimer);
}

nlohmann::json Claim(uint32_t npc, uint32_t cellOrWorld, NiPoint3 pos)
{
  return nlohmann::json{ { "t", MsgType::Host },
                         { "remoteId", 0x100000000 + npc },
                         { "worldOrCell", cellOrWorld },
                         { "pos", { pos.x, pos.y, pos.z } },
                         { "rot", { 0.f, 0.f, 0.f } } };
}

size_t CountSent(PartOne& partOne, Networking::UserId userId, MsgType type,
                 uint64_t target)
{
  return std::count_if(
    partOne.Messages().begin(), partOne.Messages().end(), [&](auto& m) {
      return m.userId == userId && m.j["t"] == type && m.j["target"] == target;
    });
}

void TickHosters(PartOne& partOne)
{
  std::this_thread::sleep_for(std::chrono::milliseconds(260));
  partOne.Tick();
}

bool SentHostedByOther(PartOne& partOne, Networking::UserId userId,
                       uint32_t idx, bool value)
{
  return std::any_of(
    partOne.Messages().begin(), partOne.Messages().end(), [&](auto& m) {
      return m.userId == userId && m.j["t"] == MsgType::UpdateProperty &&
        m.j["propName"] == "isHostedByOther" && m.j["idx"] == idx &&
        m.j["dataDump"] == (value ? "true" : "false");
    });
}

void SetPings(PartOne& partOne, std::map<Networking::UserId, int> pings)
{
  partOne.SetPingSource([pings](Networking::UserId userId) {
    auto it = pings.find(userId);
    return it == pings.end() ? 0 : it->second;
  });
}
}

TEST_CASE("A location claim enables a disabled NPC at the claim, and the "
          "server picks its hoster",
          "[NpcHost][espm][1A.2][H1]")
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

  REQUIRE(!guard.IsDisabled());
  REQUIRE((guard.GetPos() - target).Length() < 1.f);
  REQUIRE(CellOf(partOne, guard) == cell);
  REQUIRE(partOne.worldState.hosters[kInitiallyDisabledGuard] == kClaimer);

  partOne.worldState.hosters[kInitiallyDisabledGuard] = 0;
  guard.UpdateHoster(0);
  guard.SetCellOrWorld(
    FormDesc::FromFormId(guardCell, partOne.worldState.espmFiles));
  guard.SetPos(start);
  guard.Disable();
  guard.SetPropertyValueDump(MpObjectReference::kDisabledInPlay, "false",
                             false, false);
  DisconnectClaimer(partOne);
}

TEST_CASE("A claim on an enabled NPC changes neither its hoster nor its "
          "position",
          "[NpcHost][espm][1A.2][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, cell);
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  ConnectPlayer(partOne, 1, kOtherPlayer, start, cell);

  DoMessage(partOne, 1,
            Claim(kAlvor, cell, start + NiPoint3(30.f, 0.f, 0.f)));
  DoMessage(partOne, 1,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor } });

  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE((alvor.GetPos() - start).Length() < 1.f);

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("A location claim is rejected from another cell, from too far, or "
          "with a location that is not a cell or a worldspace",
          "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& guard = partOne.worldState.GetFormAt<MpActor>(kInitiallyDisabledGuard);
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  REQUIRE(guard.IsDisabled());

  SECTION("another cell")
  {
    ConnectClaimer(partOne, alvor, kTamriel);
    DoMessage(partOne, 0, Claim(kInitiallyDisabledGuard, cell, start));
  }
  SECTION("too far")
  {
    ConnectClaimer(partOne, alvor, cell);
    DoMessage(partOne, 0,
              Claim(kInitiallyDisabledGuard, cell,
                    { start.x + 5000.f, start.y, start.z }));
  }
  SECTION("not a cell or a worldspace")
  {
    ConnectClaimer(partOne, alvor, cell);
    DoMessage(partOne, 0, Claim(kInitiallyDisabledGuard, kAlvor, start));
  }
  SECTION("no position")
  {
    ConnectClaimer(partOne, alvor, cell);
    auto claim = Claim(kInitiallyDisabledGuard, cell, start);
    claim.erase("pos");
    DoMessage(partOne, 0, claim);
  }

  REQUIRE(guard.IsDisabled());
  REQUIRE(partOne.worldState.hosters[kInitiallyDisabledGuard] == 0);

  DisconnectClaimer(partOne);
}

TEST_CASE("Nobody can host the actor of a player", "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  ConnectClaimer(partOne, alvor, cell);
  auto& other = ConnectPlayer(partOne, 1, kOtherPlayer, alvor.GetPos(), cell);

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", kOtherPlayer } });
  DoMessage(partOne, 0, Claim(kOtherPlayer, cell, alvor.GetPos()));
  partOne.RefreshHoster(other);

  REQUIRE(partOne.worldState.hosters[kOtherPlayer] == 0);

  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("The hoster reports an NPC disabled, a plain release changes "
          "nothing",
          "[NpcHost][espm][1A.2][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  const bool disable = GENERATE(false, true);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor },
                            { "release", true },
                            { "disabled", disable } });

  REQUIRE(partOne.worldState.hosters[kAlvor] == (disable ? 0 : kClaimer));
  REQUIRE(alvor.IsDisabled() == disable);

  alvor.Enable();
  alvor.SetPropertyValueDump(MpObjectReference::kDisabledInPlay, "false",
                             false, false);
  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  DisconnectClaimer(partOne);
}

TEST_CASE("Only the hoster can report an NPC disabled",
          "[NpcHost][espm][1A.2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, cell);
  partOne.RefreshHoster(alvor);
  ConnectPlayer(partOne, 1, kOtherPlayer, alvor.GetPos(), cell);

  DoMessage(partOne, 1,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor },
                            { "release", true },
                            { "disabled", true } });

  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE(!alvor.IsDisabled());

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("The first visitor runs every NPC of a cell, a newcomer takes "
          "over only with a ping more than 40 ms lower",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  partOne.CreateActor(kServerNpc, start, 0, cell);
  auto& npc = partOne.worldState.GetFormAt<MpActor>(kServerNpc);
  npc.ForceSubscriptionsUpdate();
  const int newcomerPing = GENERATE(10, 9);
  SetPings(partOne, { { 0, 50 }, { 1, newcomerPing } });

  partOne.Messages().clear();
  ConnectClaimer(partOne, alvor, cell);
  TickHosters(partOne);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == kClaimer);
  REQUIRE(CountSent(partOne, 0, MsgType::HostStart, 0x100000000 + kAlvor) ==
          1);

  partOne.Messages().clear();
  ConnectPlayer(partOne, 1, kOtherPlayer, start, cell);
  TickHosters(partOne);

  const uint32_t expected = newcomerPing < 10 ? kOtherPlayer : kClaimer;
  REQUIRE(partOne.worldState.hosters[kAlvor] == expected);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == expected);
  REQUIRE(CountSent(partOne, 0, MsgType::HostStop, 0x100000000 + kAlvor) ==
          (expected == kOtherPlayer ? 1 : 0));
  REQUIRE(CountSent(partOne, 1, MsgType::HostStart, 0x100000000 + kAlvor) ==
          (expected == kOtherPlayer ? 1 : 0));
  if (expected == kOtherPlayer) {
    REQUIRE(SentHostedByOther(partOne, 0, alvor.GetIdx(), true));
    REQUIRE(SentHostedByOther(partOne, 1, alvor.GetIdx(), false));
  }

  partOne.worldState.hosters[kAlvor] = 0;
  partOne.worldState.hosters[kServerNpc] = 0;
  alvor.UpdateHoster(0);
  partOne.DestroyActor(kServerNpc);
  SetPings(partOne, {});
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("A ping takeover leaves followers to their owner and waits 10 s "
          "before the next one",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  constexpr uint32_t kFollower = 0xff000004;
  auto& hosters = partOne.worldState.hosters;
  SetPings(partOne, { { 0, 50 }, { 1, 9 } });
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  TickHosters(partOne);
  partOne.CreateActor(kServerNpc, kRiverwoodSpot, 0, kTamriel);
  partOne.CreateActor(kFollower, kRiverwoodSpot, 0, kTamriel);
  auto& npc = partOne.worldState.GetFormAt<MpActor>(kServerNpc);
  auto& follower = partOne.worldState.GetFormAt<MpActor>(kFollower);
  npc.ForceSubscriptionsUpdate();
  follower.ForceSubscriptionsUpdate();
  partOne.worldState.hostOwners[kFollower] = kClaimer;
  partOne.RefreshHoster(npc);
  partOne.RefreshHoster(follower);
  REQUIRE(hosters[kServerNpc] == kClaimer);
  REQUIRE(hosters[kFollower] == kClaimer);

  auto& other =
    ConnectPlayer(partOne, 1, kOtherPlayer, kRiverwoodSpot, kTamriel);
  partOne.Messages().clear();
  TickHosters(partOne);
  REQUIRE(hosters[kServerNpc] == kOtherPlayer);
  REQUIRE(hosters[kFollower] == kClaimer);
  REQUIRE(CountSent(partOne, 1, MsgType::HostStart, kFollower) == 0);

  other.SetPos(kRiverwoodSpot + NiPoint3(5 * 4096.f, 0.f, 0.f));
  TickHosters(partOne);
  REQUIRE(hosters[kServerNpc] == kClaimer);
  other.SetPos(kRiverwoodSpot);
  partOne.serverState.userInfo[1]->lastMovementAt =
    std::chrono::steady_clock::now();
  TickHosters(partOne);
  REQUIRE(hosters[kServerNpc] == kClaimer);

  partOne.worldState.hostOwners.erase(kFollower);
  hosters.erase(kServerNpc);
  hosters.erase(kFollower);
  partOne.DestroyActor(kServerNpc);
  partOne.DestroyActor(kFollower);
  SetPings(partOne, {});
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("A report never enables an actor that is not an ESP NPC",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  partOne.CreateActor(kServerNpc, kRiverwoodSpot, 0, kTamriel);
  auto& npc = partOne.worldState.GetFormAt<MpActor>(kServerNpc);
  npc.Disable();

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", kServerNpc },
                            { "worldOrCell", kTamriel },
                            { "pos",
                              { kRiverwoodSpot.x, kRiverwoodSpot.y,
                                kRiverwoodSpot.z } },
                            { "rot", { 0.f, 0.f, 0.f } } });

  REQUIRE(npc.IsDisabled());
  REQUIRE(partOne.worldState.hosters[kServerNpc] == 0);

  partOne.DestroyActor(kServerNpc);
  DisconnectClaimer(partOne);
}

TEST_CASE("When the authority leaves, disconnects or goes silent, the "
          "visitor with the lowest ping runs its NPCs at once",
          "[NpcHost][espm][H1][1A.3][P2]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  SetPings(partOne, { { 0, 10 }, { 1, 50 }, { 2, 30 } });
  auto& claimer = ConnectPlayer(partOne, 0, kClaimer, start, cell);
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  ConnectPlayer(partOne, 1, kOtherPlayer, start, cell);
  ConnectPlayer(partOne, 2, kThirdPlayer, start, cell);
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  partOne.Messages().clear();

  const auto cause = GENERATE(as<std::string>{}, "leaves", "disconnects",
                              "goes silent");
  if (cause == "leaves") {
    claimer.SetCellOrWorld(
      FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
    claimer.SetPos({ 0.f, 0.f, 0.f });
  } else if (cause == "disconnects") {
    DoDisconnect(partOne, 0);
  } else {
    partOne.serverState.userInfo[0]->lastMovementAt =
      std::chrono::steady_clock::now() - std::chrono::milliseconds(3200);
    TickHosters(partOne);
  }

  REQUIRE(partOne.worldState.hosters[kAlvor] == kThirdPlayer);
  REQUIRE(CountSent(partOne, 2, MsgType::HostStart, 0x100000000 + kAlvor) ==
          1);
  REQUIRE(SentHostedByOther(partOne, 1, alvor.GetIdx(), true));
  REQUIRE(SentHostedByOther(partOne, 2, alvor.GetIdx(), false));
  if (cause != "disconnects") {
    REQUIRE(CountSent(partOne, 0, MsgType::HostStop, 0x100000000 + kAlvor) ==
            1);
  }

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  SetPings(partOne, {});
  DisconnectPlayer(partOne, 2, kThirdPlayer);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  if (cause == "disconnects") {
    partOne.DestroyActor(kClaimer);
  } else {
    DisconnectClaimer(partOne);
  }
}

TEST_CASE("An NPC that walks into a cell its hoster does not see goes to "
          "that cell's authority",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  const NiPoint3 away = kRiverwoodSpot + NiPoint3(3 * 4096.f, 0.f, 0.f);
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  ConnectPlayer(partOne, 1, kOtherPlayer, away, kTamriel);
  partOne.CreateActor(kServerNpc, kRiverwoodSpot, 0, kTamriel);
  auto& npc = partOne.worldState.GetFormAt<MpActor>(kServerNpc);
  npc.ForceSubscriptionsUpdate();
  partOne.RefreshHoster(npc);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == kClaimer);
  partOne.Messages().clear();

  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::UpdateMovement },
                            { "idx", npc.GetIdx() },
                            { "data",
                              { { "worldOrCell", kTamriel },
                                { "pos",
                                  { away.x - 4096.f, away.y, away.z } },
                                { "rot", { 0.f, 0.f, 0.f } },
                                { "runMode", "Standing" },
                                { "direction", 0.f },
                                { "healthPercentage", 1.f },
                                { "speed", 0.f },
                                { "isInJumpState", false },
                                { "isSneaking", false },
                                { "isBlocking", false },
                                { "isDead", false },
                                { "isWeapDrawn", false } } } });
  TickHosters(partOne);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == kOtherPlayer);
  REQUIRE(CountSent(partOne, 0, MsgType::HostStop, kServerNpc) == 1);
  REQUIRE(CountSent(partOne, 1, MsgType::HostStart, kServerNpc) == 1);
  REQUIRE(std::any_of(
    partOne.Messages().begin(), partOne.Messages().end(), [&](auto& m) {
      return m.userId == 1 && m.j["t"] == MsgType::UpdateProperty &&
        m.j["propName"] == "isHostedByOther" && m.j["idx"] == npc.GetIdx() &&
        m.j["dataDump"] == "false";
    }));

  partOne.worldState.hosters[kServerNpc] = 0;
  partOne.DestroyActor(kServerNpc);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("A hoster silent for 2.5 s keeps its NPCs", "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  ConnectPlayer(partOne, 1, kOtherPlayer, kRiverwoodSpot, kTamriel);
  partOne.CreateActor(kServerNpc, kRiverwoodSpot, 0, kTamriel);
  auto& npc = partOne.worldState.GetFormAt<MpActor>(kServerNpc);
  npc.ForceSubscriptionsUpdate();
  partOne.RefreshHoster(npc);
  const uint32_t hoster = partOne.worldState.hosters[kServerNpc];
  REQUIRE(hoster != 0);

  partOne.serverState.userInfo[hoster == kClaimer ? 0 : 1]->lastMovementAt =
    std::chrono::steady_clock::now() - std::chrono::milliseconds(2500);
  TickHosters(partOne);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == hoster);

  partOne.worldState.hosters[kServerNpc] = 0;
  partOne.DestroyActor(kServerNpc);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("A follower stays with her owner through a door, bots never run "
          "NPCs",
          "[NpcHost][espm][H1][F6]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, cell);
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  auto& other = ConnectPlayer(partOne, 1, kOtherPlayer, start, cell);

  partOne.Messages().clear();
  partOne.worldState.hostOwners[kAlvor] = kOtherPlayer;
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kOtherPlayer);
  REQUIRE(CountSent(partOne, 0, MsgType::HostStop, 0x100000000 + kAlvor) == 1);
  REQUIRE(CountSent(partOne, 1, MsgType::HostStart, 0x100000000 + kAlvor) ==
          1);
  REQUIRE(SentHostedByOther(partOne, 0, alvor.GetIdx(), true));
  REQUIRE(SentHostedByOther(partOne, 1, alvor.GetIdx(), false));

  other.SetCellOrWorld(
    FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
  other.SetPos(kRiverwoodSpot);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kOtherPlayer);
  auto movement = jMovement;
  movement["idx"] = alvor.GetIdx();
  movement["data"]["worldOrCell"] = kTamriel;
  movement["data"]["pos"] = { kRiverwoodSpot.x + 100.f, kRiverwoodSpot.y,
                              kRiverwoodSpot.z };
  DoMessage(partOne, 1, movement);
  REQUIRE(CellOf(partOne, alvor) == kTamriel);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kOtherPlayer);

  partOne.worldState.hostOwners.erase(kAlvor);
  SetPings(partOne, { { 1, -1 } });
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);

  SetPings(partOne, {});
  alvor.SetCellOrWorld(FormDesc::FromFormId(cell, partOne.worldState.espmFiles));
  alvor.SetPos(start);
  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("An NPC keeps its hoster in a cell the hoster still sees, and goes "
          "to the cell's authority beyond",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  const float squareSix = 26624.f;
  const float squareSeven = 30720.f;
  ConnectPlayer(partOne, 1, kOtherPlayer,
                { squareSeven, kRiverwoodSpot.y, kRiverwoodSpot.z }, kTamriel);
  TickHosters(partOne);
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  TickHosters(partOne);
  partOne.CreateActor(kServerNpc, kRiverwoodSpot, 0, kTamriel);
  auto& npc = partOne.worldState.GetFormAt<MpActor>(kServerNpc);
  npc.ForceSubscriptionsUpdate();
  partOne.RefreshHoster(npc);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == kClaimer);
  auto moveTo = [&](float x) {
    auto movement = jMovement;
    movement["idx"] = npc.GetIdx();
    movement["data"]["worldOrCell"] = kTamriel;
    movement["data"]["pos"] = { x, kRiverwoodSpot.y, kRiverwoodSpot.z };
    DoMessage(partOne, 0, movement);
    TickHosters(partOne);
  };

  moveTo(squareSix);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == kClaimer);
  moveTo(squareSeven);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == kOtherPlayer);

  partOne.worldState.hosters[kServerNpc] = 0;
  partOne.DestroyActor(kServerNpc);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("A report moves an NPC that nobody sees or runs, and is ignored "
          "while a player sees it",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  const NiPoint3 reported = kRiverwoodSpot + NiPoint3(100.f, 0.f, 0.f);

  SECTION("nobody sees him")
  {
    DoMessage(partOne, 0, Claim(kAlvor, kTamriel, reported));
    REQUIRE(CellOf(partOne, alvor) == kTamriel);
    REQUIRE((alvor.GetPos() - reported).Length() < 1.f);
    REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  }
  SECTION("another player sees him")
  {
    ConnectPlayer(partOne, 1, kOtherPlayer, start, cell);
    DoMessage(partOne, 0, Claim(kAlvor, kTamriel, reported));
    REQUIRE(CellOf(partOne, alvor) == cell);
    REQUIRE((alvor.GetPos() - start).Length() < 1.f);
    DisconnectPlayer(partOne, 1, kOtherPlayer);
  }

  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  alvor.SetCellOrWorld(FormDesc::FromFormId(cell, partOne.worldState.espmFiles));
  alvor.SetPos(start);
  DisconnectClaimer(partOne);
}

TEST_CASE("The owner's report moves his follower to him even while another "
          "player runs and sees her",
          "[NpcHost][espm][H1][F6]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectPlayer(partOne, 1, kOtherPlayer, start, cell);
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kOtherPlayer);
  ConnectPlayer(partOne, 0, kClaimer, kRiverwoodSpot, kTamriel);
  const NiPoint3 reported = kRiverwoodSpot + NiPoint3(100.f, 0.f, 0.f);

  DoMessage(partOne, 0, Claim(kAlvor, kTamriel, reported));
  REQUIRE(CellOf(partOne, alvor) == cell);

  partOne.worldState.hostOwners[kAlvor] = kClaimer;
  DoMessage(partOne, 0, Claim(kAlvor, kTamriel, reported));
  REQUIRE(CellOf(partOne, alvor) == kTamriel);
  REQUIRE((alvor.GetPos() - reported).Length() < 1.f);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  partOne.worldState.hostOwners.erase(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  alvor.UpdateHoster(0);
  alvor.SetCellOrWorld(FormDesc::FromFormId(cell, partOne.worldState.espmFiles));
  alvor.SetPos(start);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
  DisconnectClaimer(partOne);
}

TEST_CASE("An enable report is refused for an NPC disabled during play",
          "[NpcHost][espm][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, cell);
  partOne.RefreshHoster(alvor);
  DoMessage(partOne, 0,
            nlohmann::json{ { "t", MsgType::Host },
                            { "remoteId", 0x100000000 + kAlvor },
                            { "release", true },
                            { "disabled", true } });
  REQUIRE(alvor.IsDisabled());

  DoMessage(partOne, 0, Claim(kAlvor, cell, alvor.GetPos()));

  REQUIRE(alvor.IsDisabled());
  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);

  alvor.Enable();
  alvor.SetPropertyValueDump(MpObjectReference::kDisabledInPlay, "false",
                             false, false);
  DisconnectClaimer(partOne);
}

TEST_CASE("A hoster that leaves the grid of the NPC loses the host",
          "[NpcHost][espm][1A.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  partOne.Messages().clear();

  auto& claimer = partOne.worldState.GetFormAt<MpActor>(kClaimer);
  claimer.SetCellOrWorld(
    FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
  claimer.SetPos({ 0.f, 0.f, 0.f });

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE(CountSent(partOne, 0, MsgType::HostStop, 0x100000000 + kAlvor) ==
          1);

  DisconnectClaimer(partOne);
}

TEST_CASE("A hoster that disconnects loses the host", "[NpcHost][espm][1A.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  partOne.RefreshHoster(alvor);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);

  DoDisconnect(partOne, 0);

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);

  partOne.DestroyActor(kClaimer);
}

TEST_CASE("A player who is not the hoster leaves, and the hoster stays",
          "[NpcHost][espm][1A.3]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, cell);
  partOne.RefreshHoster(alvor);
  auto& other = ConnectPlayer(partOne, 1, kOtherPlayer, alvor.GetPos(), cell);

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
  ConnectClaimer(partOne, alvor, CellOf(partOne, alvor));
  partOne.RefreshHoster(alvor);
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
          "[NpcHost][espm][F5][H1]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  const NiPoint3 spot = kRiverwoodSpot;
  alvor.SetCellOrWorld(
    FormDesc::FromFormId(kTamriel, partOne.worldState.espmFiles));
  alvor.SetPos(spot);
  auto hostStops = [&] {
    return CountSent(partOne, 0, MsgType::HostStop, 0x100000000 + kAlvor);
  };

  HostAlvor(partOne, alvor);
  auto& other = ConnectPlayer(partOne, 1, kOtherPlayer, spot, kTamriel);
  partOne.Messages().clear();
  DoMessage(partOne, 0,
            Movement(alvor.GetIdx(), kTamriel,
                     { spot.x + 16 * 4096.f, spot.y, spot.z }));
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  REQUIRE(alvor.GetListeners().count(&other) == 1);
  TickHosters(partOne);
  REQUIRE(partOne.worldState.hosters[kAlvor] == kClaimer);
  DisconnectPlayer(partOne, 1, kOtherPlayer);
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

TEST_CASE("A hoster's NPC movement reaches the other players, not the hoster",
          "[NpcHost][espm][P5]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  const auto start = alvor.GetPos();
  HostAlvor(partOne, alvor);
  DoConnect(partOne, 1);
  partOne.CreateActor(kOtherPlayer, start, 0, cell);
  partOne.SetUserActor(1, kOtherPlayer);
  const auto sentTo = [&](Networking::UserId userId) {
    return std::count_if(
      partOne.Messages().begin(), partOne.Messages().end(),
      [&](auto& m) { return m.userId == userId; });
  };

  partOne.Messages().clear();
  DoMessage(partOne, 0, Movement(alvor.GetIdx(), cell, start));
  REQUIRE(sentTo(0) == 0);
  REQUIRE(sentTo(1) == 1);

  partOne.Messages().clear();
  auto& other = partOne.worldState.GetFormAt<MpActor>(kOtherPlayer);
  DoMessage(partOne, 1, Movement(other.GetIdx(), cell, start));
  REQUIRE(sentTo(1) == 1);
  REQUIRE(sentTo(0) == 1);

  partOne.DestroyActor(kOtherPlayer);
  DoDisconnect(partOne, 1);
  ReleaseAlvor(partOne, alvor, cell, start);
}

TEST_CASE("A claim without a location never changes a hoster",
          "[NpcHost][espm][P4]")
{
  auto& partOne = GetNpcHostPartOne();
  auto& alvor = partOne.worldState.GetFormAt<MpActor>(kAlvor);
  const auto cell = CellOf(partOne, alvor);
  partOne.worldState.hosters[kAlvor] = 0;
  ConnectClaimer(partOne, alvor, cell);
  partOne.CreateActor(kServerNpc, alvor.GetPos(), 0, cell);
  partOne.worldState.GetFormAt<MpActor>(kServerNpc)
    .ForceSubscriptionsUpdate();
  partOne.worldState.hosters[kServerNpc] = 0;
  const auto claim = [](uint64_t remoteId) {
    return nlohmann::json{ { "t", MsgType::Host }, { "remoteId", remoteId } };
  };

  DoMessage(partOne, 0, claim(0x100000000 + kAlvor));
  DoMessage(partOne, 0, claim(kServerNpc));

  REQUIRE(partOne.worldState.hosters[kAlvor] == 0);
  REQUIRE(partOne.worldState.hosters[kServerNpc] == 0);

  partOne.DestroyActor(kServerNpc);
  DisconnectClaimer(partOne);
}
