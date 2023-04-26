// entities/route.ts

import { Route as V1RouteSDK, Pair } from '@pollum-io/v1-sdk'
import { Route as V2RouteSDK, Pool } from '@pollum-io/v2-sdk'
import { Protocol } from './protocol'
import { Currency, Price, Token } from '@pollum-io/sdk-core'
import { MixedRouteSDK } from './mixedRoute/route'

export interface IRoute<TInput extends Currency, TOutput extends Currency, TPool extends Pool | Pair> {
  protocol: Protocol
  // array of pools if v2 or pairs if v2
  pools: TPool[]
  path: Token[]
  midPrice: Price<TInput, TOutput>
  input: TInput
  output: TOutput
}

// V1 route wrapper
export class RouteV1<TInput extends Currency, TOutput extends Currency>
  extends V1RouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, Pair>
{
  public readonly protocol: Protocol = Protocol.V1
  public readonly pools: Pair[]

  constructor(v1Route: V1RouteSDK<TInput, TOutput>) {
    super(v1Route.pairs, v1Route.input, v1Route.output)
    this.pools = this.pairs
  }
}

// V2 route wrapper
export class RouteV2<TInput extends Currency, TOutput extends Currency>
  extends V2RouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, Pool>
{
  public readonly protocol: Protocol = Protocol.V2
  public readonly path: Token[]

  constructor(v2Route: V2RouteSDK<TInput, TOutput>) {
    super(v2Route.pools, v2Route.input, v2Route.output)
    this.path = v2Route.tokenPath
  }
}

// Mixed route wrapper
export class MixedRoute<TInput extends Currency, TOutput extends Currency>
  extends MixedRouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, Pool | Pair>
{
  public readonly protocol: Protocol = Protocol.MIXED

  constructor(mixedRoute: MixedRouteSDK<TInput, TOutput>) {
    super(mixedRoute.pools, mixedRoute.input, mixedRoute.output)
  }
}
