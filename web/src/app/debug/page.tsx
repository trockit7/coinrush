"use client";
import React from "react";

function isAddr(x?: string | null) {
  return !!x && /^0x[0-9a-fA-F]{40}$/.test(x);
}

export default function DebugFactory() {
  const [state, setState] = React.useState<{ok:boolean; value?:string; err?:string}>({ok:false});

  React.useEffect(() => {
    try {
      const v = (process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ?? "").trim();
      if (!isAddr(v)) throw new Error("Missing or invalid NEXT_PUBLIC_BSC_FACTORY_ADDRESS");
      setState({ ok: true, value: v });
      console.log("DEBUG /debug → factory =", v);
    } catch (e:any) {
      const msg = e?.message || String(e);
      console.error("DEBUG /debug error:", msg);
      setState({ ok: false, err: msg });
    }
  }, []);

  return <pre style={{padding:16}}>{JSON.stringify(state, null, 2)}</pre>;
}
