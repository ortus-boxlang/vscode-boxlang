
import fs from "fs";
import { LogFileTreeItem } from "../../views/ServerHomesView";


export async function clearLogFile(item: LogFileTreeItem) {

    if (!(item instanceof LogFileTreeItem)) {
        return;
    }

    fs.writeFileSync(item.filePath, "");
}

