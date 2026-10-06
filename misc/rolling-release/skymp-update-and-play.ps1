$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = $PSScriptRoot
$settingsPath = Join-Path $root "Data\Platform\Plugins\skymp5-client-settings.txt"
$versionPath = Join-Path $root "skymp-client-version.txt"
$zipPath = Join-Path $env:TEMP "skymp-client.zip"

if (-not (Test-Path $settingsPath)) {
    $serverIp = Read-Host "Server IP address"
    [ordered]@{
        "gameData" = @{ "profileId" = Get-Random -Minimum 1000 -Maximum 2147483647 }
        "master" = ""
        "server-ip" = $serverIp.Trim()
        "server-master-key" = $null
        "server-port" = 7777
    } | ConvertTo-Json | Set-Content $settingsPath
}

try {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    $serverPort = [int]$settings.'server-port'
    $httpPort = if ($serverPort -eq 7777) { 3000 } else { $serverPort + 1 }
    $baseUrl = "http://$($settings.'server-ip'):$httpPort/client"

    $remoteVersion = (Invoke-WebRequest "$baseUrl/version.txt" -UseBasicParsing -TimeoutSec 15).Content.Trim()
    $localVersion = if (Test-Path $versionPath) { (Get-Content $versionPath -Raw).Trim() } else { "" }

    if ($remoteVersion -eq $localVersion) {
        Write-Host "The client is up to date."
    } else {
        Write-Host "Downloading the new client..."
        Invoke-WebRequest "$baseUrl/skymp-client.zip" -OutFile $zipPath -UseBasicParsing

        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $stream = [System.IO.File]::OpenRead($zipPath)
        try {
            $hash = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
        } finally {
            $stream.Dispose()
        }
        if ($hash -ne $remoteVersion) {
            throw "The download is incomplete. Try again in one minute."
        }

        Write-Host "Installing the new client..."
        & "$env:SystemRoot\System32\tar.exe" -xf $zipPath -C $root
        if ($LASTEXITCODE -ne 0) {
            throw "The install failed. Close Skyrim, then try again."
        }
        Set-Content $versionPath $remoteVersion
        Remove-Item $zipPath
        Write-Host "The client is up to date."
    }
} catch {
    Write-Warning "Update failed: $($_.Exception.Message)"
    Read-Host "Push Enter to start the game with the current client"
}

Start-Process (Join-Path $root "skse64_loader.exe") -WorkingDirectory $root
