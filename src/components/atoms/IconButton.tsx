import { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export default function IconButton({ children, className, ...rest }: IconButtonProps) {
  return (
    <button className={className} {...rest}>
      {children}
    </button>
  );
}
