import { JSX } from 'solid-js';

type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'className'> & {
  variant?: 'primary' | 'ghost';
};

export function Button(props: ButtonProps) {
  const { variant = 'primary', children, type = 'button', ...rest } = props;
  const className = variant === 'ghost' ? 'btn-ghost' : 'btn-primary';
  return (
    <button class={className} type={type} {...rest}>
      {children}
    </button>
  );
}
