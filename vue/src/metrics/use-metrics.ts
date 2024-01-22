import { snakeCase } from 'lodash-es'
import { shallowRef, computed, watch, proxyRefs, ShallowRef } from 'vue'
import { refDebounced } from '@vueuse/core'

// Composables
import { useRoute } from '@/use/router'
import { useWatchAxios, AxiosParamsSource } from '@/use/watch-axios'
import { injectForceReload } from '@/use/force-reload'

// Misc
import { emptyMetric, Metric, ActiveMetric, MetricAlias, Instrument } from '@/metrics/types'

export type UseMetrics = ReturnType<typeof useMetrics>

export function useMetrics(
  axiosParamsSource: AxiosParamsSource | undefined = undefined,
  debounce = 0,
) {
  const route = useRoute()
  const forceReload = injectForceReload()

  const { status, loading, data, reload } = useWatchAxios(() => {
    const params = axiosParamsSource ? axiosParamsSource() : {}
    if (!params) {
      return params
    }

    const { projectId } = route.value.params
    return {
      url: `/internal/v1/metrics/${projectId}`,
      params: {
        ...forceReload.params,
        ...params,
      },
    }
  })

  const metrics = computed((): Metric[] => {
    return data.value?.metrics ?? []
  })

  const noData = computed((): boolean => {
    return status.value.hasData() && metrics.value.length === 0
  })

  return proxyRefs({
    status,
    loading,
    reload,

    noData,
    items: metrics,
  })
}

export function metricShortName(name: string): string {
  const ident: string[] = []

  const ss = name.split(/[./]/).reverse()
  for (let s of ss) {
    s = s.replaceAll(/[^a-z0-9]+/gi, '_')
    ident.push(s)

    if (s.length >= 2 && s.match(/[a-z][a-z0-9_]+/i)) {
      break
    }
  }

  return ident.reverse().join('.')
}

//------------------------------------------------------------------------------

export interface ExploredMetric {
  name: string
  attrKeys: string[]
  instrument: Instrument
  numTimeseries: number
}

export function useExploreMetrics(axiosParamsSource: AxiosParamsSource) {
  const route = useRoute()

  const searchInput = shallowRef('')
  const debouncedSearchInput = refDebounced(searchInput, 600)
  const hasMore = shallowRef(false)

  const { status, loading, data, reload } = useWatchAxios(() => {
    const params = axiosParamsSource()

    if (params) {
      params.search_input = debouncedSearchInput.value
    }

    const { projectId } = route.value.params
    return {
      url: `/internal/v1/metrics/${projectId}/stats`,
      params,
    }
  })

  const metrics = computed((): ExploredMetric[] => {
    return data.value?.metrics ?? []
  })

  watch(
    () => data.value?.hasMore ?? false,
    (hasMoreValue) => {
      hasMore.value = hasMoreValue
    },
  )

  return proxyRefs({
    status,
    loading,
    reload,

    searchInput,
    items: metrics,
    hasMore,
  })
}

//------------------------------------------------------------------------------

export function useActiveMetrics(activeMetrics: ShallowRef<MetricAlias[]>) {
  const route = useRoute()

  const { data } = useWatchAxios(() => {
    if (!activeMetrics.value.length) {
      return undefined
    }

    const { projectId } = route.value.params
    return {
      url: `/internal/v1/metrics/${projectId}/describe`,
      params: {
        metric: activeMetrics.value.map((m) => m.name),
      },
    }
  })

  const metrics = computed((): ActiveMetric[] => {
    const metrics: ActiveMetric[] = data.value?.metrics ?? []
    return activeMetrics.value.map((metric) => {
      const found = metrics.find((m) => m.name === metric.name)
      if (!found) {
        return {
          ...emptyMetric(),
          ...metric,
        }
      }
      return {
        ...found,
        ...metric,
      }
    })
  })

  return metrics
}

export function defaultMetricQuery(instrument: Instrument, alias: string) {
  alias = '$' + alias
  switch (instrument) {
    case Instrument.Deleted:
      return ''
    case Instrument.Gauge:
      return `avg(${alias})`
    case Instrument.Additive:
      return `sum(${alias})`
    case Instrument.Counter:
      return `per_min(sum(${alias}))`
    case Instrument.Histogram:
      return `avg(${alias}) | per_min(count(${alias}))`
    case Instrument.Summary:
      return `avg(${alias})`
    default:
      // eslint-disable-next-line no-console
      console.error('unknown metric instrument', instrument)
      return alias
  }
}

export function defaultMetricAlias(metricName: string): string {
  let i = metricName.lastIndexOf('.')
  if (i >= 0) {
    metricName = metricName.slice(i + 1)
    if (metricName.length < 20) {
      return snakeCase(metricName)
    }
  }

  i = metricName.lastIndexOf('_')
  if (i >= 0) {
    metricName = metricName.slice(i + 1)
  }
  return snakeCase(metricName)
}
