// A stand-in for the classic theme's `@theme/Navbar/Search`, which the plugin's own wraps: the
// container the navbar renders its search box in. Aliased in vitest.config.ts.
import type { ReactNode } from 'react';

export default function NavbarSearch({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={className ? `navbar-search ${className}` : 'navbar-search'}>{children}</div>
  );
}
