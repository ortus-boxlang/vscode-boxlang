git submodule update --init --recursive

Push-Location ./boxlang

&./gradlew.bat shadowJar

Pop-Location

New-Item -ItemType File -Path ./resources/lib/boxlang-1.0.0-all.jar -Force
Copy-Item -Path ./boxlang/build/libs/boxlang-1.0.0-all.jar -Destination ./resources/lib/boxlang-1.0.0-all.jar

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

