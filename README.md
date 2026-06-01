# Meu App de Rotas Escolar

Aplicação web para consulta de endereços, CEPs e cálculo de rotas em um mapa interativo.

Este projeto foi desenvolvido como uma das atividades da minha jornada no curso do SENAI: **Desenvolvimento de aplicações de IA generativa utilizando Google Antigravity**.

## Objetivo

O objetivo da atividade foi criar uma página web funcional para visualização de mapas e cálculo de rotas, aplicando conceitos de desenvolvimento front-end, consumo de APIs externas e integração com serviços de geolocalização.

A aplicação permite informar origem, destino e paradas intermediárias para gerar uma rota no mapa, exibindo distância, tempo estimado e instruções de navegação.

## Funcionalidades

- Visualização de mapa interativo com Leaflet.
- Alternância entre camadas de mapa:
  - mapa de ruas;
  - modo escuro;
  - satélite.
- Busca de endereços com autocomplete.
- Consulta de CEPs brasileiros usando ViaCEP.
- Cálculo de rotas com origem, destino e paradas.
- Marcadores diferentes para início, destino e paradas.
- Exibição da distância total, do tempo estimado e das instruções da rota.
- Tratamento visual de erros nos campos.
- Estado de carregamento durante o cálculo da rota.
- Layout responsivo para telas menores.

## Tecnologias Utilizadas

- HTML5
- CSS3
- JavaScript
- Leaflet
- OpenStreetMap / Nominatim
- OSRM
- ViaCEP

## Estrutura do Projeto

```text
.
+-- index.html
+-- style.css
+-- app.js
+-- README.md
```

## Como Executar

Você pode abrir o arquivo `index.html` diretamente no navegador.

Para uma execução mais estável, recomenda-se usar um servidor local:

```powershell
npx serve .
```

Depois, acesse o endereço exibido no terminal. Normalmente será algo como:

```text
http://localhost:3000
```

## Como Usar

1. Digite um endereço ou CEP no campo de origem.
2. Digite um endereço ou CEP no campo de destino.
3. Opcionalmente, adicione paradas intermediárias.
4. Clique em **Calcular Rota**.
5. Veja a rota desenhada no mapa, junto com a distância, o tempo estimado e as instruções.

## APIs e Serviços Externos

O app utiliza serviços externos gratuitos:

- **ViaCEP** para buscar endereços a partir de CEPs brasileiros.
- **Nominatim/OpenStreetMap** para transformar endereços em coordenadas.
- **OSRM** para calcular rotas entre os pontos.

Por depender de serviços externos, a aplicação precisa de conexão com a internet para funcionar completamente.

## Melhorias Implementadas

Durante a revisão do projeto, foram aplicadas melhorias importantes:

- Correção de textos com problemas de codificação.
- Remoção de proxies CORS públicos para evitar o envio de endereços do usuário para serviços de terceiros.
- Adição de cache e timeout nas chamadas externas.
- Busca de endereços limitada ao Brasil.
- Bloqueio do botão de cálculo enquanto a rota está sendo processada.
- Tratamento mais claro para erros de endereço e roteamento.

## Status

Projeto acadêmico em desenvolvimento, criado para praticar a construção de uma interface web integrada a APIs de mapas e rotas.
