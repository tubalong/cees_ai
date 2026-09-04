import type { PropsWithChildren } from 'react';

export function PageHeader({ children }: PropsWithChildren): JSX.Element {
    return <header style={{ marginBottom: 20 }}><h1 style={{ margin: 0, fontSize: 24 }}>{children}</h1></header>;
}