npm install

npm run build

npm run pack

If ($?) {
    code --uninstall-extension ortus-solutions.boxlang

    $latestBuild = get-childitem boxlang-*.vsix | Sort-Object -Descending LastWriteTime | Select-Object -First 1

    code --install-extension $latestBuild.Name
}
Else {
    Write-Host "Error occurred while building extension"
}

