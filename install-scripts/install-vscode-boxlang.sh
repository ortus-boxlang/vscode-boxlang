main(){
    local releases=$(curl -s "https://api.github.com/repos/ortus-boxlang/vscode-boxlang/releases" | grep browser_download_url)

    local release_url=$(echo "$releases" | head -n 1 | grep -o -p "https.*vsix")

    if [[ -z "${bx_version}" ]]; then
        echo "No bx_version provided installing the latest version"
    else
        local selected_url=$(echo "$releases" | grep "$bx_version" | grep -o -P "https.+vsix" )

        if [[ -z "${selected_url}" ]]; then
            echo "Couldn't find a version for $bx_version"
            exit 0
        fi

        release_url=$selected_url
    fi

    echo "downloading $release_url"

    local temp=$(mktemp -d)

    echo "$temp"

    curl -L -o "$temp/vscode-boxlang.vsix" "$release_url"

    code --uninstall-extension ortus-solutions.boxlang

    code --install-extension "$temp/vscode-boxlang.vsix"
}

main
