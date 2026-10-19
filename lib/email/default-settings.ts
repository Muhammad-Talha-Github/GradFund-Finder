export const DEFAULT_EMAIL_TEMPLATE = `Dear {{professor}},
Greetings! I hope this email finds you well. I’m applying to {{University}} and by great coincidence, I came across your personal website. Your research interests such as {{professors interests}} align with my own interests. I am eager to explore how we can {{my addition to professors research interest}}

I’m an AI Engineer at [Hazen.ai](http://hazen.ai/) and a graduate from [NUST](https://nust.edu.pk/). I’ve authored four [research publications](https://drive.google.com/file/d/1DrwWuGcPJj8yHFzjZwSzMYFNaIML5NrV/view?usp=sharing) (2 under review) which center around aforementioned interests. I was in the middle of my application to {{university's short name}} and really wanted to reach out to you in advance. This email serves to share my CV and request a discussion. My CV contains links to everything including my github. My transcript is also shared. I have [IELTS Band 8.0](https://drive.google.com/file/d/1YVHkqqw1f_S_bEZUavB-f6F-bDgpuKLj/view?usp=drive_link)

If my background and interests align with your lab's needs, I would greatly appreciate a brief 15 minute chat to discuss potential fit before I finalize my application.

Thank you for your time and consideration.
Best regards,
Muhammad Talha
AI Engineer, Hazen.ai`;

export const DEFAULT_ADJUSTMENT_RULES = `Personalize the base email for the selected professor and opportunity while preserving the applicant's first-person voice, stated credentials, counts, and links exactly. Only use professor, university, program, and research details explicitly present in the saved opportunity and its evidence excerpts. Do not invent professor interests, the applicant's research interests or contribution, funding, deadlines, papers, or prior contact. If a research-interest or contribution placeholder is not supported by the opportunity or applicant context, leave it visibly marked as [please personalize: ...] for the applicant to complete. Keep the email professional and concise (roughly 180–250 words). Return only a subject and email body; never send email.`;
