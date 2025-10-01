import React from "react";
import "../(lite)/theme.css";

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return <div data-lite-root>{children}</div>;
}
