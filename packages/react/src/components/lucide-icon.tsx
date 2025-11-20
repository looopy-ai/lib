import { icons, type LucideProps } from 'lucide-react';
import type { ReactNode } from 'react';

export type LucideIconName = keyof typeof icons;

export type LucideIconProps = LucideProps & {
  name: LucideIconName;
  /**
   * Rendered when the provided name does not match a Lucide icon.
   */
  fallback?: ReactNode;
};

export const LucideIcon = ({ name, fallback = null, ...rest }: LucideIconProps): ReactNode => {
  const IconComponent = icons[name];

  if (!IconComponent) {
    return fallback;
  }

  return <IconComponent {...rest} />;
};
