// src/types/web3modal.d.ts
declare namespace JSX {
    interface IntrinsicElements {
      "w3m-connect-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "w3m-account-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "w3m-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        size?: "sm" | "md" | "lg";
        balance?: "hide" | "show";
      };
    }
  }