import { Currency, CurrencyAmount, Fraction, Percent, Price, TradeType } from '@pollum-io/sdk-core'
import { Pair, Route as V1RouteSDK, Trade as V1TradeSDK } from '@pollum-io/v1-sdk'
import { Pool, Route as V2RouteSDK, Trade as V2TradeSDK } from '@pollum-io/v2-sdk'
import invariant from 'tiny-invariant'
import { ONE, ZERO } from '../constants'
import { MixedRouteSDK } from './mixedRoute/route'
import { MixedRouteTrade as MixedRouteTradeSDK } from './mixedRoute/trade'
import { IRoute, MixedRoute, RouteV1, RouteV2 } from './route'

export class Trade<TInput extends Currency, TOutput extends Currency, TTradeType extends TradeType> {
  public readonly routes: IRoute<TInput, TOutput, Pair | Pool>[]
  public readonly tradeType: TTradeType
  private _outputAmount: CurrencyAmount<TOutput> | undefined
  private _inputAmount: CurrencyAmount<TInput> | undefined

  /**
   * The swaps of the trade, i.e. which routes and how much is swapped in each that
   * make up the trade. May consist of swaps in v1 or v2.
   */
  public readonly swaps: {
    route: IRoute<TInput, TOutput, Pair | Pool>
    inputAmount: CurrencyAmount<TInput>
    outputAmount: CurrencyAmount<TOutput>
  }[]

  //  construct a trade across v1 and v2 routes from pre-computed amounts
  public constructor({
    v1Routes,
    v2Routes,
    tradeType,
    mixedRoutes,
  }: {
    v1Routes: {
      routev1: V1RouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[]
    v2Routes: {
      routev2: V2RouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[]
    tradeType: TTradeType
    mixedRoutes?: {
      mixedRoute: MixedRouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[]
  }) {
    this.swaps = []
    this.routes = []
    // wrap v1 routes
    for (const { routev1, inputAmount, outputAmount } of v1Routes) {
      const route = new RouteV1(routev1)
      this.routes.push(route)
      this.swaps.push({
        route,
        inputAmount,
        outputAmount,
      })
    }
    // wrap v2 routes
    for (const { routev2, inputAmount, outputAmount } of v2Routes) {
      const route = new RouteV2(routev2)
      this.routes.push(route)
      this.swaps.push({
        route,
        inputAmount,
        outputAmount,
      })
    }
    // wrap mixedRoutes
    if (mixedRoutes) {
      for (const { mixedRoute, inputAmount, outputAmount } of mixedRoutes) {
        const route = new MixedRoute(mixedRoute)
        this.routes.push(route)
        this.swaps.push({
          route,
          inputAmount,
          outputAmount,
        })
      }
    }
    this.tradeType = tradeType

    // each route must have the same input and output currency
    const inputCurrency = this.swaps[0].inputAmount.currency
    const outputCurrency = this.swaps[0].outputAmount.currency
    invariant(
      this.swaps.every(({ route }) => inputCurrency.wrapped.equals(route.input.wrapped)),
      'INPUT_CURRENCY_MATCH'
    )
    invariant(
      this.swaps.every(({ route }) => outputCurrency.wrapped.equals(route.output.wrapped)),
      'OUTPUT_CURRENCY_MATCH'
    )

    // pools must be unique inter protocols
    const numPools = this.swaps.map(({ route }) => route.pools.length).reduce((total, cur) => total + cur, 0)
    const poolAddressSet = new Set<string>()
    for (const { route } of this.swaps) {
      for (const pool of route.pools) {
        if (pool instanceof Pool) {
          poolAddressSet.add(Pool.getAddress(pool.token0, pool.token1, (pool as Pool).fee))
        } else if (pool instanceof Pair) {
          const pair = pool
          poolAddressSet.add(Pair.getAddress(pair.token0, pair.token1))
        } else {
          throw new Error('Unexpected pool type in route when constructing trade object')
        }
      }
    }
    invariant(numPools == poolAddressSet.size, 'POOLS_DUPLICATED')
  }

  public get inputAmount(): CurrencyAmount<TInput> {
    if (this._inputAmount) {
      return this._inputAmount
    }

    const inputCurrency = this.swaps[0].inputAmount.currency
    const totalInputFromRoutes = this.swaps
      .map(({ inputAmount }) => inputAmount)
      .reduce((total, cur) => total.add(cur), CurrencyAmount.fromRawAmount(inputCurrency, 0))

    this._inputAmount = totalInputFromRoutes
    return this._inputAmount
  }

  public get outputAmount(): CurrencyAmount<TOutput> {
    if (this._outputAmount) {
      return this._outputAmount
    }

    const outputCurrency = this.swaps[0].outputAmount.currency
    const totalOutputFromRoutes = this.swaps
      .map(({ outputAmount }) => outputAmount)
      .reduce((total, cur) => total.add(cur), CurrencyAmount.fromRawAmount(outputCurrency, 0))

    this._outputAmount = totalOutputFromRoutes
    return this._outputAmount
  }

  private _executionPrice: Price<TInput, TOutput> | undefined

  /**
   * The price expressed in terms of output amount/input amount.
   */
  public get executionPrice(): Price<TInput, TOutput> {
    return (
      this._executionPrice ??
      (this._executionPrice = new Price(
        this.inputAmount.currency,
        this.outputAmount.currency,
        this.inputAmount.quotient,
        this.outputAmount.quotient
      ))
    )
  }

  /**
   * The cached result of the price impact computation
   * @private
   */
  private _priceImpact: Percent | undefined
  /**
   * Returns the percent difference between the route's mid price and the price impact
   */
  public get priceImpact(): Percent {
    if (this._priceImpact) {
      return this._priceImpact
    }

    let spotOutputAmount = CurrencyAmount.fromRawAmount(this.outputAmount.currency, 0)
    for (const { route, inputAmount } of this.swaps) {
      const midPrice = route.midPrice
      spotOutputAmount = spotOutputAmount.add(midPrice.quote(inputAmount))
    }

    const priceImpact = spotOutputAmount.subtract(this.outputAmount).divide(spotOutputAmount)
    this._priceImpact = new Percent(priceImpact.numerator, priceImpact.denominator)

    return this._priceImpact
  }

  /**
   * Get the minimum amount that must be received from this trade for the given slippage tolerance
   * @param slippageTolerance The tolerance of unfavorable slippage from the execution price of this trade
   * @returns The amount out
   */
  public minimumAmountOut(slippageTolerance: Percent, amountOut = this.outputAmount): CurrencyAmount<TOutput> {
    invariant(!slippageTolerance.lessThan(ZERO), 'SLIPPAGE_TOLERANCE')
    if (this.tradeType === TradeType.EXACT_OUTPUT) {
      return amountOut
    } else {
      const slippageAdjustedAmountOut = new Fraction(ONE)
        .add(slippageTolerance)
        .invert()
        .multiply(amountOut.quotient).quotient
      return CurrencyAmount.fromRawAmount(amountOut.currency, slippageAdjustedAmountOut)
    }
  }

  /**
   * Get the maximum amount in that can be spent via this trade for the given slippage tolerance
   * @param slippageTolerance The tolerance of unfavorable slippage from the execution price of this trade
   * @returns The amount in
   */
  public maximumAmountIn(slippageTolerance: Percent, amountIn = this.inputAmount): CurrencyAmount<TInput> {
    invariant(!slippageTolerance.lessThan(ZERO), 'SLIPPAGE_TOLERANCE')
    if (this.tradeType === TradeType.EXACT_INPUT) {
      return amountIn
    } else {
      const slippageAdjustedAmountIn = new Fraction(ONE).add(slippageTolerance).multiply(amountIn.quotient).quotient
      return CurrencyAmount.fromRawAmount(amountIn.currency, slippageAdjustedAmountIn)
    }
  }

  /**
   * Return the execution price after accounting for slippage tolerance
   * @param slippageTolerance the allowed tolerated slippage
   * @returns The execution price
   */
  public worstExecutionPrice(slippageTolerance: Percent): Price<TInput, TOutput> {
    return new Price(
      this.inputAmount.currency,
      this.outputAmount.currency,
      this.maximumAmountIn(slippageTolerance).quotient,
      this.minimumAmountOut(slippageTolerance).quotient
    )
  }

  public static async fromRoutes<TInput extends Currency, TOutput extends Currency, TTradeType extends TradeType>(
    v1Routes: {
      routev1: V1RouteSDK<TInput, TOutput>
      amount: TTradeType extends TradeType.EXACT_INPUT ? CurrencyAmount<TInput> : CurrencyAmount<TOutput>
    }[],
    v2Routes: {
      routev2: V2RouteSDK<TInput, TOutput>
      amount: TTradeType extends TradeType.EXACT_INPUT ? CurrencyAmount<TInput> : CurrencyAmount<TOutput>
    }[],
    tradeType: TTradeType,
    mixedRoutes?: {
      mixedRoute: MixedRouteSDK<TInput, TOutput>
      amount: TTradeType extends TradeType.EXACT_INPUT ? CurrencyAmount<TInput> : CurrencyAmount<TOutput>
    }[]
  ): Promise<Trade<TInput, TOutput, TTradeType>> {
    const populatedV1Routes: {
      routev1: V1RouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[] = []

    const populatedV2Routes: {
      routev2: V2RouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[] = []

    const populatedMixedRoutes: {
      mixedRoute: MixedRouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[] = []

    for (const { routev1, amount } of v1Routes) {
      const v1Trade = new V1TradeSDK(routev1, amount, tradeType)
      const { inputAmount, outputAmount } = v1Trade

      populatedV1Routes.push({
        routev1,
        inputAmount,
        outputAmount,
      })
    }

    for (const { routev2, amount } of v2Routes) {
      const v2Trade = await V2TradeSDK.fromRoute(routev2, amount, tradeType)
      const { inputAmount, outputAmount } = v2Trade

      populatedV2Routes.push({
        routev2,
        inputAmount,
        outputAmount,
      })
    }

    if (mixedRoutes) {
      for (const { mixedRoute, amount } of mixedRoutes) {
        const mixedRouteTrade = await MixedRouteTradeSDK.fromRoute(mixedRoute, amount, tradeType)
        const { inputAmount, outputAmount } = mixedRouteTrade

        populatedMixedRoutes.push({
          mixedRoute,
          inputAmount,
          outputAmount,
        })
      }
    }

    return new Trade({
      v1Routes: populatedV1Routes,
      v2Routes: populatedV2Routes,
      mixedRoutes: populatedMixedRoutes,
      tradeType,
    })
  }

  public static async fromRoute<TInput extends Currency, TOutput extends Currency, TTradeType extends TradeType>(
    route: V1RouteSDK<TInput, TOutput> | V2RouteSDK<TInput, TOutput> | MixedRouteSDK<TInput, TOutput>,
    amount: TTradeType extends TradeType.EXACT_INPUT ? CurrencyAmount<TInput> : CurrencyAmount<TOutput>,
    tradeType: TTradeType
  ): Promise<Trade<TInput, TOutput, TTradeType>> {
    let v1Routes: {
      routev1: V1RouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[] = []

    let v2Routes: {
      routev2: V2RouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[] = []

    let mixedRoutes: {
      mixedRoute: MixedRouteSDK<TInput, TOutput>
      inputAmount: CurrencyAmount<TInput>
      outputAmount: CurrencyAmount<TOutput>
    }[] = []

    if (route instanceof V1RouteSDK) {
      const v1Trade = new V1TradeSDK(route, amount, tradeType)
      const { inputAmount, outputAmount } = v1Trade
      v1Routes = [{ routev1: route, inputAmount, outputAmount }]
    } else if (route instanceof V2RouteSDK) {
      const v2Trade = await V2TradeSDK.fromRoute(route, amount, tradeType)
      const { inputAmount, outputAmount } = v2Trade
      v2Routes = [{ routev2: route, inputAmount, outputAmount }]
    } else if (route instanceof MixedRouteSDK) {
      const mixedRouteTrade = await MixedRouteTradeSDK.fromRoute(route, amount, tradeType)
      const { inputAmount, outputAmount } = mixedRouteTrade
      mixedRoutes = [{ mixedRoute: route, inputAmount, outputAmount }]
    } else {
      throw new Error('Invalid route type')
    }

    return new Trade({
      v1Routes,
      v2Routes,
      mixedRoutes,
      tradeType,
    })
  }
}
