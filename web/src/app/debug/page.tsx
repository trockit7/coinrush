"use client";
import React from "react";
import { getFactoryAddress } from "@/lib/eth";

export default function DebugFactory() {
  const [state, setState] = React.useState<{ok:boolean; value?:string; err?:string}>({ok:false});

  React.useEffect(() => {
    try {
      const v = getFactoryAddress();
      setState({ ok: true, value: v });
      // also surface in console
      console.log("DEBUG /debug → getFactoryAddress() =", v);
    } catch (e:any) {
      const msg = e?.message || String(e);
      console.error("DEBUG /debug error:", msg);
      setState({ ok: false, err: msg });
    }
  }, []);

  return (
    <pre style={{padding:16}}>
      {JSON.stringify(state, null, 2)}
    </pre>
  );
}
