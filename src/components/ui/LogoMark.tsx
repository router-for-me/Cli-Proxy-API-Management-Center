import type { SVGProps } from 'react';

export interface LogoMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const baseSvgProps: SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 100 100',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

export function LogoMark({ size = 24, ...props }: LogoMarkProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <polygon points="50 4 96 50 50 96 4 50" strokeWidth={6} />
      <g strokeWidth={5}>
        <polygon points="72 50 61 69.053 39 69.053 28 50 39 30.947 61 30.947" />
        <polygon points="69.053 61 50 72 30.947 61 30.947 39 50 28 69.053 39" />
      </g>
    </svg>
  );
}
