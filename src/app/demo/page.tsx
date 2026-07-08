"use client";

import { useEffect } from "react";
import BotPulseDapp from "../BotPulseDapp";

export default function DemoPage() {
  useEffect(() => {
    const target = document.getElementById("interact");
    target?.scrollIntoView({ block: "start" });
  }, []);

  return <BotPulseDapp />;
}
