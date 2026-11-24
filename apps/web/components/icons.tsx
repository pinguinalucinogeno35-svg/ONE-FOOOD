import type { ReactNode, SVGProps } from 'react';

/**
 * Ícones próprios do ONE Food. Um sistema só: quadro de 24, traço de 1,75, pontas e cantos
 * arredondados, cor herdada do texto. Nenhum emoji ou caractere faz papel de ícone no produto.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { label?: string };

function Icon({ label, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const IconMinus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 12h13" />
  </Icon>
);

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

/** Sacola de pedido, com a alça passando por dentro. */
export const IconBag = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 8.5h14l-1 11H6l-1-11z" />
    <path d="M9 11V7.5a3 3 0 016 0V11" />
  </Icon>
);

export const IconBack = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5.5M11 6.5L5.5 12l5.5 5.5" />
  </Icon>
);

export const IconForward = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" />
  </Icon>
);

/** Etapa cumprida: marca dentro de um selo. */
export const IconDone = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.2l2.4 2.4 4.6-5" />
  </Icon>
);

/** Relógio de preparo. */
export const IconClock = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

/** Moto de entrega vista de lado, reduzida a duas rodas e o baú. */
export const IconDelivery = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="6.5" cy="16.5" r="2.5" />
    <circle cx="17.5" cy="16.5" r="2.5" />
    <path d="M9 16.5h6l-2-6h-3M13 10.5l1.5-3H17M4 9.5h4.5v4H4z" />
  </Icon>
);

/** Balcão de retirada. */
export const IconPickup = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10.5h16M5.5 10.5v8h13v-8M4 10.5l1.5-5h13l1.5 5M10 18.5v-4.5h4v4.5" />
  </Icon>
);

export const IconEdit = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 19l.8-3.6L15.5 5.7a1.8 1.8 0 012.6 0l.2.2a1.8 1.8 0 010 2.6L8.6 18.2 5 19zM13.8 7.4l2.8 2.8" />
  </Icon>
);

export const IconTrash = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 7.5h14M9.5 7.5V5.5h5v2M7 7.5l.8 11h8.4l.8-11M10.5 11v4.5M13.5 11v4.5" />
  </Icon>
);

/** Ponto de conexão ao vivo. */
export const IconLive = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5a6.4 6.4 0 000 9M16.5 7.5a6.4 6.4 0 010 9" />
  </Icon>
);
