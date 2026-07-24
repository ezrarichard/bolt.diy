import * as React from 'react';
import { classNames } from '~/utils/classNames';
import { BuildersSurface, type BuildersSurfaceProps } from './BuildersSurface';

/**
 * Builders Design System (Sprint 69) — the shared card composition, built on `BuildersSurface`.
 * Mirrors `app/components/ui/Card.tsx`'s shadcn-style composition (`Header`/`Title`/
 * `Description`/`Content`/`Footer`) deliberately, so migrating a call site is a rename, not a
 * restructure — but every color/radius/border decision now comes from Builders tokens instead
 * of being retyped per usage.
 */

export interface BuildersCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color'>, BuildersSurfaceProps {}

const BuildersCard = React.forwardRef<HTMLDivElement, BuildersCardProps>(
  ({ className, elevation, border, radius, shadow, ...props }, ref) => {
    return (
      <BuildersSurface
        ref={ref}
        elevation={elevation}
        border={border}
        radius={radius}
        shadow={shadow}
        className={classNames('p-5', className)}
        {...props}
      />
    );
  },
);
BuildersCard.displayName = 'BuildersCard';

const BuildersCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={classNames('flex flex-col gap-1 mb-4', className)} {...props} />
  ),
);
BuildersCardHeader.displayName = 'BuildersCardHeader';

const BuildersCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={classNames('text-base font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  ),
);
BuildersCardTitle.displayName = 'BuildersCardTitle';

const BuildersCardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={classNames('text-sm text-builders-text-secondary', className)} {...props} />
  ),
);
BuildersCardDescription.displayName = 'BuildersCardDescription';

const BuildersCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={classNames(className)} {...props} />,
);
BuildersCardContent.displayName = 'BuildersCardContent';

const BuildersCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={classNames('flex items-center gap-2 mt-4', className)} {...props} />
  ),
);
BuildersCardFooter.displayName = 'BuildersCardFooter';

export {
  BuildersCard,
  BuildersCardHeader,
  BuildersCardTitle,
  BuildersCardDescription,
  BuildersCardContent,
  BuildersCardFooter,
};
