'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { forwardRef, useId, cloneElement, isValidElement } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, ReactElement } from 'react';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  }
>(function Button({ className, variant = 'secondary', ...props }, ref) {
  return <button ref={ref} className={cn('btn', `btn-${variant}`, className)} {...props} />;
});
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn('input', className)} {...props} />;
  },
);
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="field">
      <span id={`${id}-label`}>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            'aria-labelledby': `${id}-label`,
            ...(hint ? { 'aria-describedby': `${id}-hint` } : {}),
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'green' | 'amber' | 'red' | 'neutral' | 'purple';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Modal({
  title,
  description,
  open,
  onOpenChange,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={cn('dialog-content', wide && 'dialog-wide')}>
          <div className="dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || 'Review and save your changes.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Close dialog">
                <X size={19} />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-orbit">◇</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeleton-page" aria-label="Loading portfolio">
      <div className="skeleton h-12 w-64" />
      <div className="kpi-grid">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton h-36" key={i} />
        ))}
      </div>
      <div className="skeleton h-80" />
    </div>
  );
}
