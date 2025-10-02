export default function EnvPage() {
    return (
      <pre>
        {JSON.stringify(
          { NEXT_PUBLIC_BSC_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_BSC_FACTORY_ADDRESS ?? null },
          null,
          2
        )}
      </pre>
    );
  }