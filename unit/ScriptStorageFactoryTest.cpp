#include "script_storages/ScriptStorageFactory.h"
#include <catch2/catch_all.hpp>
#include <filesystem>
#include <fstream>

TEST_CASE("Server reads vanilla scripts from Skyrim - Misc.bsa next to "
          "Skyrim.esm when archives is not set",
          "[2B.2]")
{
  auto dir = std::filesystem::temp_directory_path() / "skymp_2b2_archives";
  std::filesystem::remove_all(dir);
  std::filesystem::create_directories(dir / "data");
  std::ofstream(dir / "SKYRIM.ESM") << "";

  nlohmann::json settings = {
    { "dataDir", (dir / "data").string() },
    { "loadOrder", { (dir / "SKYRIM.ESM").string(), "Update.esm" } }
  };
  REQUIRE(ScriptStorageFactory::GetArchivePaths(settings).empty());

  std::ofstream(dir / "Skyrim - Misc.bsa") << "";
  REQUIRE(ScriptStorageFactory::GetArchivePaths(settings) ==
          std::vector<std::string>{ (dir / "Skyrim - Misc.bsa").string() });

  settings["archives"] = nlohmann::json::array();
  REQUIRE(ScriptStorageFactory::GetArchivePaths(settings).empty());

  settings["archives"] = { "Other.bsa" };
  REQUIRE(ScriptStorageFactory::GetArchivePaths(settings) ==
          std::vector<std::string>{ (dir / "data" / "Other.bsa").string() });

  std::filesystem::remove_all(dir);
}
