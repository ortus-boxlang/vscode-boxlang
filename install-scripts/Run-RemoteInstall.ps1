

$releases = Invoke-WebRequest "https://api.github.com/repos/ortus-boxlang/vscode-boxlang/releases" | Convertfrom-json
$releaseData = $releases | Select -First 1

if ( $bx_version ) {
    $releaseData = $releases | Where-Object -Property name -Match $bx_version

    if ( !$releaseData ) {
        Write-Host "Unable to find a matching version for $bx_version"
        return
    }
}

$TempDir = [System.IO.Path]::GetTempPath()
$extFile = ( Join-Path $TempDir "vscode-boxlang.vsix" )

Write-Host $releaseData.assets.browser_download_url

Invoke-WebRequest $releaseData.assets.browser_download_url -OutFile $extFile
return

try {
    code --uninstall-extension ortus-solutions.boxlang
}
catch {

}

Write-Host "Installing the extension now - if this hangs simply cancel, close all VSCode windows and run the install script again"
code --install-extension $extFile
