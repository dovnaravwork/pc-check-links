namespace PcCheck.Core;

public static class VerdictEngine
{
    public static Verdict Compute(IEnumerable<CheckSection> sections)
    {
        ArgumentNullException.ThrowIfNull(sections);

        var statuses = sections.Select(section => section.Status).ToArray();
        if (statuses.Length == 0)
        {
            return new Verdict(
                CheckStatus.Unverified,
                "Обязательные проверки ещё не выполнены.");
        }

        if (statuses.Contains(CheckStatus.Stop))
        {
            return new Verdict(
                CheckStatus.Stop,
                "Обнаружен стоп-фактор. Останови сделку, выясни причину и повтори проверку после исправления.");
        }

        if (statuses.Contains(CheckStatus.Unverified))
        {
            return new Verdict(
                CheckStatus.Unverified,
                "Хотя бы один обязательный пункт не подтверждён и не может считаться успешным.");
        }

        if (statuses.Contains(CheckStatus.Caution))
        {
            return new Verdict(
                CheckStatus.Caution,
                "Есть оценимый недостаток. Зафиксируй стоимость устранения до оплаты.");
        }

        return new Verdict(
            CheckStatus.Pass,
            "В этой короткой проверке неисправности не обнаружены. Это не прогноз будущей надёжности.");
    }
}
