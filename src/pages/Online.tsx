import { Globe, LogIn, Server } from "lucide-react";
import type { Notify } from "../hooks";
import PageHeader from "../ui/PageHeader";
import Segmented from "../ui/Segmented";
import Host from "./Host";
import Join from "./Join";

export type OnlineTab = "host" | "join";

interface Props {
  playerName: string;
  notify: Notify;
  /** Onglet affiché ; piloté par l'application pour que l'accueil puisse ouvrir directement « Rejoindre ». */
  tab: OnlineTab;
  onTab: (t: OnlineTab) => void;
}

export default function Online({ playerName, notify, tab, onTab: setTab }: Props) {
  return (
    <div className="page">
      <PageHeader
        eyebrow={<><Globe size={13} /> Multijoueur</>}
        title="En ligne"
        subtitle={tab === "host" ? "Crée ton serveur en quelques clics et invite tes amis." : "Rejoins une partie avec un code d'invitation."}
        actions={
          <Segmented
            hot
            value={tab}
            onChange={setTab}
            options={[
              { value: "host", label: "Créer une partie", icon: <Server size={15} /> },
              { value: "join", label: "Rejoindre", icon: <LogIn size={15} /> },
            ]}
          />
        }
      />
      {/* Les deux vues restent montées pour conserver la console du serveur et les réglages. */}
      <div hidden={tab !== "host"}>
        <Host playerName={playerName} notify={notify} />
      </div>
      <div hidden={tab !== "join"}>
        <Join playerName={playerName} notify={notify} />
      </div>
    </div>
  );
}
