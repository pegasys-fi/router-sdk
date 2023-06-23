// entities/route.ts

import { Route as V1RouteSDK, Pair } from '@pollum-io/v1-sdk'
import { Route as V3RouteSDK, Pool } from '@pollum-io/v3-sdk'
import { Protocol } from './protocol'
import { Currency, Price, Token } from '@pollum-io/sdk-core'
import { MixedRouteSDK } from './mixedRoute/route'

export interface IRoute<TInput extends Currency, TOutput extends Currency, TPool extends Pool | Pair> {
  protocol: Protocol
  // array of pools if v3 or pairs if v1
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

// V3 route wrapper
export class RouteV3<TInput extends Currency, TOutput extends Currency>
  extends V3RouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, Pool>
{
  public readonly protocol: Protocol = Protocol.V3
  public readonly path: Token[]

  constructor(v3Route: V3RouteSDK<TInput, TOutput>) {
    super(v3Route.pools, v3Route.input, v3Route.output)
    this.path = v3Route.tokenPath
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
