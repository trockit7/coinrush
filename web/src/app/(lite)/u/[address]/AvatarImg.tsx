"use client";

import * as React from "react";

type Props = {
  src?: string | null;
  alt?: string;
  size?: number;               // px
  className?: string;
  style?: React.CSSProperties;
  rounded?: number;            // border radius in px
};

export default function AvatarImg({
  src,
  alt = "",
  size = 88,
  className = "",
  style,
  rounded = 12,
}: Props) {
  const [err, setErr] = React.useState(false);
  const url = !src || err ? "/avatar-placeholder.png" : src;

  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: rounded, objectFit: "cover", ...style }}
      onError={() => setErr(true)}
    />
  );
}
