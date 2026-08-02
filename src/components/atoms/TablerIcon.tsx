interface TablerIconProps {
  name: string;
  className?: string;
}

export default function TablerIcon({ name, className }: TablerIconProps) {
  return <i className={`ti ${name}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
