# Meu App de Rotas Escolar

Aplicacao web para consulta de enderecos, CEPs e calculo de rotas em mapa interativo.

Este projeto foi desenvolvido como uma das atividades da minha jornada no curso do SENAI: **Desenvolvimento de aplicacoes de IA generativa utilizando Google Antigravity**.

## Objetivo

O objetivo da atividade foi criar uma pagina web funcional para visualizacao de mapas e calculo de rotas, aplicando conceitos de desenvolvimento front-end, consumo de APIs externas e interacao com servicos de geolocalizacao.

A aplicacao permite informar origem, destino e paradas intermediarias para gerar uma rota no mapa, exibindo distancia, tempo estimado e instrucoes de navegacao.

## Funcionalidades

- Visualizacao de mapa interativo com Leaflet.
- Alternancia entre camadas de mapa:
  - mapa de ruas;
  - modo escuro;
  - satelite.
- Busca de enderecos com autocomplete.
- Consulta de CEPs brasileiros usando ViaCEP.
- Calculo de rotas com origem, destino e paradas.
- Marcadores diferentes para inicio, destino e paradas.
- Exibicao de distancia total, tempo estimado e instrucoes da rota.
- Tratamento visual de erros nos campos.
- Estado de carregamento durante o calculo da rota.
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

Voce pode abrir o arquivo `index.html` diretamente no navegador.

Para uma execucao mais estavel, recomenda-se usar um servidor local:

```powershell
npx serve .
```

Depois, acesse o endereco exibido no terminal. Normalmente sera algo como:

```text
http://localhost:3000
```

## Como Usar

1. Digite um endereco ou CEP no campo de origem.
2. Digite um endereco ou CEP no campo de destino.
3. Opcionalmente, adicione paradas intermediarias.
4. Clique em **Calcular Rota**.
5. Veja a rota desenhada no mapa, junto com distancia, tempo estimado e instrucoes.

## APIs e Servicos Externos

O app utiliza servicos externos gratuitos:

- **ViaCEP** para buscar enderecos a partir de CEPs brasileiros.
- **Nominatim/OpenStreetMap** para transformar enderecos em coordenadas.
- **OSRM** para calcular rotas entre os pontos.

Por depender de servicos externos, a aplicacao precisa de conexao com a internet para funcionar completamente.

## Melhorias Implementadas

Durante a revisao do projeto, foram aplicadas melhorias importantes:

- Correcao de textos com problemas de codificacao.
- Remocao de proxies CORS publicos para evitar envio de enderecos do usuario para servicos terceiros.
- Adicao de cache e timeout nas chamadas externas.
- Busca de enderecos limitada ao Brasil.
- Bloqueio do botao de calculo enquanto a rota esta sendo processada.
- Tratamento mais claro para erros de endereco e roteamento.

## Status

Projeto academico em desenvolvimento, criado para praticar a construcao de uma interface web integrada a APIs de mapas e rotas.
