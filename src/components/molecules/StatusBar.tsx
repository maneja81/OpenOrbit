interface StatusBarProps {
  statusText: string;
}

export default function StatusBar({ statusText }: StatusBarProps) {
  return (
    <div id="stbar">
      <span id="sttxt">{statusText}</span>
    </div>
  );
}
