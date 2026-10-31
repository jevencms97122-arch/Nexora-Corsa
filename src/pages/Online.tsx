import { useState } from "react";
import Host from "./Host";
import Join from "./Join";

interface Props {
  playerName: string;
  notify: (msg: string, kind?: "ok" | "error") => void;
}

export default function Online({ playerName, notify }: Props) {
  const [tab, setTab] = useState<"join" | "host">("host");
  return (
    <div className="page">
      <h1>En ligne</h1>
      <div className="tabs">
        <button className={tab === "host" ? "active" : ""} onClick={() => setTab("host")}>
          Créer une partie
        </button>
        <button className={tab === "join" ? "active" : ""} onClick={() => setTab("join")}>
          Rejoindre
        </button>
      </div>
      {/* Les deux pages restent montées pour conserver la console serveur et les réglages. */}
      <div hidden={tab !== "host"}>
        <Host playerName={playerName} notify={notify} />
      </div>
      <div hidden={tab !== "join"}>
        <Join playerName={playerName} notify={notify} />
      </div>
    </div>
  );
}
