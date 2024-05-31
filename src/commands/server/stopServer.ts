import { BoxLang } from "../../utils/BoxLang";
import { getServerData } from "../../utils/Server";

export async function stopServer({ key }) {
    const server = getServerData(key);

    if (!server || server.status === "stopped") {
        return;
    }

    BoxLang.stopMiniServer(server);
}
